/**
 * sim_events.js
 * Analyzes weekly simulation data and injects random dynamic events.
 */

window.SimEvents = {
    generateWeeklyEvents() {
        const gs = window.GameState;
        console.log("Generating Weekly Dynamic Events...");

        // 1. Process Sponsorship Incomes
        this._processEconomy(gs);

        // 2. Roll random dynamic events for player club
        this._rollRandomEvents(gs);
    },

    _processEconomy(gs) {
        let playerClub = gs.clubs[gs.playerClubId];
        if (!playerClub) return;

        let sponsorTier = playerClub.sponsor || 'bronze';
        let income = 0;

        let prLevel = playerClub.facilities?.pr || 1;
        let prMult = 1 + (prLevel * 0.15);

        if (sponsorTier === 'bronze') {
            income = 10000 * prMult;
        } else if (sponsorTier === 'silver') {
            let totalWinStreaks = 0;
            playerClub.fighter_ids.forEach(id => {
                let f = gs.getFighter(id);
                if (f && f.dynamic_state.win_streak > 0) {
                    totalWinStreaks += f.dynamic_state.win_streak;
                }
            });
            income = (5000 + (totalWinStreaks * 2000)) * prMult;
        } else if (sponsorTier === 'gold') {
            income = (gs.fame * 2.5) * prMult;
        }

        income = Math.floor(income);
        gs.money += income;

        if (window.UIClub) {
            console.log(`Club earned $${income.toLocaleString()} this week from sponsorships!`);
        }
    },

    _rollRandomEvents(gs) {
        let playerClub = gs.clubs[gs.playerClubId];
        if (!playerClub) return;

        // 10% chance of a random event each week
        if (Math.random() < 0.10) {
            let possibleEvents = [];

            // 1. Gym Equipment Failure (Needs L1/L2 Gym)
            if (playerClub.facilities && playerClub.facilities.gym <= 2 && gs.money >= 5000) {
                possibleEvents.push({
                    title: "Gym Equipment Failure",
                    weight: 10,
                    effect: () => {
                        gs.money -= 5000;
                        let fId = playerClub.fighter_ids[Math.floor(Math.random() * playerClub.fighter_ids.length)];
                        let f = gs.getFighter(fId);
                        if (f) { f.dynamic_state.fatigue += 30; f.dynamic_state.morale -= 10; }
                    },
                    desc: `A piece of aging training equipment snapped! A random fighter was bruised, and you paid $5,000 for emergency repairs.`
                });
            }

            // 2. Veteran Mentorship
            let veterans = playerClub.fighter_ids.map(id => gs.getFighter(id)).filter(f => f && f.age >= 30 && ((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3) > 70);
            let rookies = playerClub.fighter_ids.map(id => gs.getFighter(id)).filter(f => f && f.age <= 22 && ((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3) < 65);
            if (veterans.length > 0 && rookies.length > 0) {
                possibleEvents.push({
                    title: "Veteran Mentorship",
                    weight: 15,
                    effect: () => {
                        let vet = veterans[Math.floor(Math.random() * veterans.length)];
                        let rook = rookies[Math.floor(Math.random() * rookies.length)];
                        rook.core_stats.technique = Math.min(rook.potential || 80, rook.core_stats.technique + 2);
                        window.GameState.addNews('club', `${vet.name} took ${rook.name} under her wing this week, permanently boosting her technique.`);
                    },
                    desc: `A veteran fighter took one of your rookies aside for specialized mentorship, permanently raising her technique!`,
                    type: 'success'
                });
            }

            // 3. Locker Room Clash (Egos)
            let alphas = playerClub.fighter_ids.map(id => gs.getFighter(id)).filter(f => f && (f.personality?.archetype === 'Alpha' || (f.personality?.dominance_hunger || 0) > 75));
            if (alphas.length >= 2) {
                possibleEvents.push({
                    title: "Locker Room Clash",
                    weight: 10,
                    effect: () => {
                        window._pendingLockerRoomClash = [alphas[0], alphas[1]];
                    },
                    desc: `Two massive egos in your locker room have physically clashed over training times! You must step in and manage the situation immediately.`,
                    type: 'danger',
                    isInteractive: true
                });
            }

            // 4. Sponsor's Golden Girl
            let streakingFighters = playerClub.fighter_ids.map(id => gs.getFighter(id)).filter(f => f && (f.dynamic_state.win_streak || 0) >= 4);
            if (streakingFighters.length > 0 && playerClub.sponsor && playerClub.sponsor !== 'none') {
                possibleEvents.push({
                    title: "Sponsor's Golden Girl",
                    weight: 15,
                    effect: () => {
                        let f = streakingFighters[Math.floor(Math.random() * streakingFighters.length)];
                        let bonus = Math.floor(Math.random() * 15000) + 10000;
                        gs.money += bonus;
                        window.GameState.addNews('finance', `Sponsor thrilled with ${f.name}'s win streak. Sent a $${bonus.toLocaleString()} bonus check!`);
                    },
                    desc: `Your sponsor is absolutely thrilled with your fighter's recent win streak and has cut the club a surprise bonus check!`,
                    type: 'success'
                });
            }

            // 5. Bad Weight Cut
            let fightingThisWeek = playerClub.fighter_ids.map(id => gs.getFighter(id)).filter(f => {
                if (!f) return false;
                if (window.SimSchedule && window.SimSchedule.getCurrentWeekMatches) {
                    let matches = window.SimSchedule.getCurrentWeekMatches();
                    return matches.some(m => m.f1 === f.id || m.f2 === f.id);
                }
                return false;
            });
            if (fightingThisWeek.length > 0) {
                possibleEvents.push({
                    title: "Brutal Weight Cut",
                    weight: 10,
                    effect: () => {
                        let f = fightingThisWeek[Math.floor(Math.random() * fightingThisWeek.length)];
                        f.dynamic_state.fatigue = Math.min(100, (f.dynamic_state.fatigue || 0) + 40);
                    },
                    desc: `One of your fighters mismanaged her diet and had a brutal, depleting weight cut. She will enter her match this week severely fatigued!`,
                    type: 'danger'
                });
            }

            if (possibleEvents.length > 0) {
                // Weighted random selection
                let totalWeight = possibleEvents.reduce((sum, e) => sum + e.weight, 0);
                let roll = Math.random() * totalWeight;
                let currentWeight = 0;
                let selectedEvent = null;
                for (let e of possibleEvents) {
                    currentWeight += e.weight;
                    if (roll < currentWeight) { selectedEvent = e; break; }
                }

                if (selectedEvent) {
                    selectedEvent.effect();

                    if (selectedEvent.isInteractive) {
                        this._handleInteractiveEvent(selectedEvent);
                    } else {
                        setTimeout(() => {
                            if (window.UIComponents && window.UIComponents.showModal) {
                                window.UIComponents.showModal(selectedEvent.title, selectedEvent.desc, selectedEvent.type || 'info');
                            } else {
                                alert(`Dynamic Event: ${selectedEvent.title}\n\n${selectedEvent.desc}`);
                            }
                        }, 500);
                    }
                }
            }
        }
    },

    _handleInteractiveEvent(ev) {
        if (ev.title === "Locker Room Clash") {
            let [f1, f2] = window._pendingLockerRoomClash;
            let p = confirm(`CRISIS: ${f1.name} and ${f2.name} are screaming at each other in the gym.\n\n[OK] Side with ${f1.name} (punish ${f2.name})\n[Cancel] Side with ${f2.name} (punish ${f1.name})`);
            if (p) {
                f1.dynamic_state.morale = Math.min(100, (f1.dynamic_state.morale || 50) + 15);
                f2.dynamic_state.morale = Math.max(0, (f2.dynamic_state.morale || 50) - 40);
                f2.dynamic_state.stress = Math.min(100, (f2.dynamic_state.stress || 0) + 30);
                alert(`You sided with ${f1.name}. ${f2.name} is furious and feels betrayed.`);
            } else {
                f2.dynamic_state.morale = Math.min(100, (f2.dynamic_state.morale || 50) + 15);
                f1.dynamic_state.morale = Math.max(0, (f1.dynamic_state.morale || 50) - 40);
                f1.dynamic_state.stress = Math.min(100, (f1.dynamic_state.stress || 0) + 30);
                alert(`You sided with ${f2.name}. ${f1.name} is furious and feels betrayed.`);
            }
            window._pendingLockerRoomClash = null;
        }
    },

    processPostMatch(winnerId, loserId, roundDiff, matchStyle) {
        const gs = window.GameState;
        let w = gs.getFighter(winnerId);
        let l = gs.getFighter(loserId);

        if (window.RelationshipEngine) {
            window.RelationshipEngine.hookIntoMatchResult(winnerId, loserId);
        }

        // roundDiff: 0-1 = close, 2-3 = clear, 4 = dominant, 5 = whitewash
        let diff = roundDiff ?? 0;
        let isBlowout = diff >= 4; // 5-1 or 5-0 scoreline
        let isDominant = diff >= 2; // 5-2 or 5-3

        if (w) {
            w.dynamic_state.wins = (w.dynamic_state.wins || 0) + 1;
            w.dynamic_state.win_streak = (w.dynamic_state.win_streak || 0) + 1;

            // Win Bonus Payout
            if (w.club_id === gs.playerClubId && w.contract) {
                let prize = Math.floor(Math.random() * 3000) + 3000;
                gs.money += prize;
                gs.money -= w.contract.win_bonus;
                gs.addNews('finance', `Earned $${prize.toLocaleString()} prize money, but paid $${w.contract.win_bonus} win bonus to ${w.name}.`);
            }

            // Winner takes moderate fatigue regardless; less in a blowout (didn't have to work as hard)
            w.dynamic_state.fatigue = Math.min(100, (w.dynamic_state.fatigue || 0) + (isBlowout ? 10 : 18));

            // Ego
            if (w.dynamic_state.win_streak >= 3) {
                w.dynamic_state.ego = 'High';
                // Specific Style Growth
                if (matchStyle && w.style_affinities && w.style_affinities[matchStyle] !== undefined) {
                    let ceiling = w.potential || 80;
                    if (w.style_affinities[matchStyle] < ceiling) {
                        w.style_affinities[matchStyle] = Math.min(ceiling, w.style_affinities[matchStyle] + (isBlowout ? 2.0 : 1.0));
                    }
                }
            }

            // Motivator Staff Trait
            let wClub = gs.getClub(w.club_id);
            if (wClub && wClub.staff) {
                let hasMotivator = Object.values(wClub.staff).some(sId => gs.staff[sId]?.trait === 'Motivator');
                if (hasMotivator) {
                    wClub.fighter_ids.forEach(fId => {
                        let f = gs.getFighter(fId);
                        if (f && f.id !== w.id && f.dynamic_state) {
                            f.dynamic_state.morale = Math.min(100, (f.dynamic_state.morale || 50) + 5);
                        }
                    });
                    if (w.club_id === gs.playerClubId) {
                        gs.addNews('club', `Your Motivator coach rallied the team after ${w.name}'s win! Rest of roster morale increased.`);
                    }
                }
            }
        }

        if (l) {
            l.dynamic_state.losses = (l.dynamic_state.losses || 0) + 1;
            l.dynamic_state.win_streak = 0;
            l.dynamic_state.ego = 'Normal';

            // ── LOSER CONSEQUENCES — SCALED BY MATCH BRUTALITY ──────────────

            // Fatigue: brutal matches exhaust the loser heavily
            let fatigueDamage = isBlowout ? 40 : isDominant ? 25 : 12;
            l.dynamic_state.fatigue = Math.min(100, (l.dynamic_state.fatigue || 0) + fatigueDamage);

            // Morale: proportional to how badly she was beaten
            let moraleDamage = isBlowout ? 35 : isDominant ? 20 : 10;
            l.dynamic_state.morale = Math.max(0, (l.dynamic_state.morale || 50) - moraleDamage);

            // Stress: absorbing punishment is psychologically costly
            let stressDamage = isBlowout ? 30 : isDominant ? 18 : 8;
            l.dynamic_state.stress = Math.min(100, (l.dynamic_state.stress || 0) + stressDamage);

            // Composure chip: getting dominated erodes mental fortitude over time
            if (isBlowout) {
                l.core_stats.composure = Math.max(1, (l.core_stats.composure || 50) - 2);
                l.core_stats.resilience = Math.max(1, (l.core_stats.resilience || 50) - 1);
                gs.addNews('club', `${l.name} was badly beaten — her composure and resilience have taken a lasting hit.`);
            } else if (isDominant) {
                l.core_stats.composure = Math.max(1, (l.core_stats.composure || 50) - 1);
            }

            // Psychological scarring: blowout losses carry a recovery penalty flag
            // (Used by the weekly recovery pass to slow her fatigue/stress healing)
            if (isBlowout) {
                l.dynamic_state.scarred_weeks = 2; // heals 50% slower for 2 weeks
            }

            // Specific Style Growth (Loser learns a bit too)
            if (matchStyle && l.style_affinities && l.style_affinities[matchStyle] !== undefined) {
                let ceiling = l.potential || 80;
                if (l.style_affinities[matchStyle] < ceiling) {
                    l.style_affinities[matchStyle] = Math.min(ceiling, l.style_affinities[matchStyle] + 0.5);
                }
            }
        }
    },

    triggerFinancialCrisis() {
        const gs = window.GameState;
        let playerClub = gs.getClub(gs.playerClubId);

        if (!playerClub.fighter_ids || playerClub.fighter_ids.length === 0) {
            // Can't sell if empty, just reset counter to delay game over
            gs.financial_crisis_weeks = 0;
            return;
        }

        // Find lowest rated fighter
        let lowestFighter = null;
        let lowestOvr = 999;

        playerClub.fighter_ids.forEach(id => {
            let f = gs.getFighter(id);
            if (f) {
                let ovr = Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                if (ovr < lowestOvr) {
                    lowestOvr = ovr;
                    lowestFighter = f;
                }
            }
        });

        if (lowestFighter) {
            let salePrice = (lowestOvr * 200) + ((lowestFighter.dynamic_state.fame || 0) * 0.3);
            playerClub.fighter_ids = playerClub.fighter_ids.filter(id => id !== lowestFighter.id);
            lowestFighter.club_id = null;
            lowestFighter.contract.happiness = 50; // reset
            gs.transferPool.push(lowestFighter.id);
            gs.money += salePrice;

            gs.financial_crisis_weeks = 0; // Reset after forced sale

            let crisisText = `Your club has been operating in extreme debt for 3 consecutive weeks. The league has stepped in and seized the contract of ${lowestFighter.name}, liquidating it for $${Math.floor(salePrice).toLocaleString()} to cover your outstanding liabilities.`;

            gs.addNews('club', `FINANCIAL CRISIS: Forced sale of ${lowestFighter.name} to cover debts.`);

            if (window.UIComponents && window.UIComponents.showModal) {
                window.UIComponents.showModal("FINANCIAL CRISIS", crisisText, "danger");
            } else {
                alert(`FINANCIAL CRISIS\n\n${crisisText}`);
            }
        }
    }
};

// Hook into AI engine
if (window.AIEngine && window.AIEngine._advanceTime) {
    const originalAdvance = window.AIEngine._advanceTime;
    window.AIEngine._advanceTime = function () {
        // Run events before saving
        if (window.SimEvents) window.SimEvents.generateWeeklyEvents();
        originalAdvance.apply(this);
    };
}