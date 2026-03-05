/**
 * ai_engine.js
 * Drives the world forward each week. Connects AI choices and match generation.
 */

window.AIEngine = {
    processWeek() {
        console.log(`Processing Week ${window.GameState.week}...`);
        const gs = window.GameState;

        // 1. AI Clubs spend AP on training/interactions
        Object.keys(gs.clubs).forEach(clubId => {
            if (clubId === gs.playerClubId) return; // Skip player
            this._runAIClubLogic(gs.clubs[clubId]);
        });

        // 2. Play scheduled AI matches silently
        let matchesThisWeek = gs.schedule.filter(m => m.week === gs.week);
        matchesThisWeek.forEach(m => {
            if (m.home !== gs.playerClubId && m.away !== gs.playerClubId) {
                this._simulateGhostMatch(m);
            }
        });

        // Note: Player's match handle separately by UI

        // 3. Advance Week markers
        this._advanceTime();

        // 4. Poaching Checks (End of Week)
        this._processPoaching();
    },

    _processPoaching() {
        const gs = window.GameState;
        let pclub = gs.getClub(gs.playerClubId);
        if (pclub && pclub.fighter_ids) {
            gs.pendingPoachEvents = gs.pendingPoachEvents || []; // KEEP FOR COMPATIBILITY IF OLD SAVES HAVE THEM, BUT WE WONT USE THEM IN UI ANYMORE

            pclub.fighter_ids.forEach(id => {
                let f = gs.getFighter(id);
                // 1. Random Poaching Attempt on Star Players
                if (f && f.contract && (f.contract.seasons_remaining <= 1 || (f.record && f.record.w > 4))) {
                    if (Math.random() < 0.08) { // 8% chance per week per star
                        let aiClubs = Object.values(gs.clubs).filter(c => c.id !== gs.playerClubId);
                        let bidder = aiClubs[Math.floor(Math.random() * aiClubs.length)];
                        let cs = f.core_stats;
                        let ovr = (cs.power + cs.technique + cs.speed) / 3;
                        let baseFee = Math.floor(ovr * 1500);
                        let finalBid = baseFee + (Math.floor(Math.random() * 8000));

                        if (bidder.money > finalBid && bidder.fighter_ids.length < 8) {
                            // Instead of UI blocking, evaluate happiness instantly
                            let aiOffer = f.contract.salary * (1.5 + Math.random());

                            // Happiness check: Highly loyal fighters reject even massive offers
                            if (f.dynamic_state.happiness >= 85 && aiOffer < f.contract.salary * 3) {
                                gs.addNews("transfer", `🛡️ LOYALTY: ${bidder.name} offered a massive contract to steal ${f.name}, but she rejected it out of loyalty to ${pclub.name}!`);
                                f.dynamic_state.morale = Math.min(100, f.dynamic_state.morale + 10); // Boost morale for staying loyal
                            } else if (f.dynamic_state.happiness >= 70 && aiOffer < f.contract.salary * 2) {
                                gs.addNews("transfer", `🛡️ REJECTED: ${bidder.name} tried to poach ${f.name}, but she is content at ${pclub.name} and declined the offer.`);
                            } else {
                                // POACH SUCCESS
                                bidder.money -= finalBid;
                                gs.money += finalBid;
                                pclub.fighter_ids = pclub.fighter_ids.filter(fid => fid !== f.id);
                                f.club_id = bidder.id;
                                f.contract.salary = Math.floor(aiOffer);
                                f.contract.release_clause = f.contract.salary * 8;
                                f.contract.happiness = 100;
                                f.contract.seasons_remaining = 3;
                                bidder.fighter_ids.push(f.id);

                                if (window.UIComponents && window.UIComponents.showModal) {
                                    window.UIComponents.showModal(
                                        "🚨 HOSTILE TAKEOVER SUCCESSFUL",
                                        `**${bidder.name}** has paid a massive **$${finalBid.toLocaleString()}** transfer fee and offered a highly lucrative contract to **${f.name}**!\n\nDue to her current happiness and contract status, she has accepted their offer and left your club immediately. The transfer fee has been deposited.`,
                                        "danger"
                                    );
                                }
                                gs.addNews("transfer", `💣 SHOCK POACH: ${bidder.name} paid $${finalBid.toLocaleString()} to poach ${f.name} from ${pclub.name}!`);
                            }
                        }
                    }
                }

                // 2. FM-Style Ruthless Release Clause Trigger
                if (f && f.contract && f.contract.release_clause > 0) {
                    let rc = f.contract.release_clause;
                    let ovr = (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3;

                    // Is the release clause criminally low for their skill?
                    // Expected value: 80 OVR = ~ $20,000+ perceived worth easily.
                    let perceivedValue = (ovr * 200) + ((f.dynamic_state.wins || 0) * 400);

                    if (rc < perceivedValue * 2 && ovr > 65) {
                        // Scan for a rich AI club
                        let richestClubs = Object.values(gs.clubs)
                            .filter(c => c.id !== gs.playerClubId && c.fighter_ids.length < 8 && c.money > rc * 4)
                            .sort((a, b) => b.money - a.money);

                        if (richestClubs.length > 0 && Math.random() < 0.05) { // 5% chance per week
                            let predator = richestClubs[0];

                            // Happiness check for Release Clause triggers too
                            let aiOffer = f.contract.salary * 1.5;
                            if (f.dynamic_state.happiness >= 85 && aiOffer < f.contract.salary * 3) {
                                gs.addNews("transfer", `🛡️ LOYALTY: ${predator.name} triggered the release clause for ${f.name}, but she rejected their contract offer!`);
                                f.dynamic_state.morale = Math.min(100, f.dynamic_state.morale + 10);
                            } else {
                                // Execute ruthless poaching!
                                predator.money -= rc;
                                gs.money += rc;

                                pclub.fighter_ids = pclub.fighter_ids.filter(fid => fid !== f.id);

                                f.club_id = predator.id;
                                f.contract.salary = Math.floor(rc / 3);
                                f.contract.release_clause = f.contract.salary * 10; // Predator club locks them down
                                f.contract.happiness = 100;
                                f.contract.seasons_remaining = 3;
                                predator.fighter_ids.push(f.id);

                                if (window.UIComponents && window.UIComponents.showModal) {
                                    window.UIComponents.showModal(
                                        "🚨 RELEASE CLAUSE TRIGGERED",
                                        `**${predator.name}** has ruthlessly bypassed negotiations and triggered the **$${rc.toLocaleString()}** release clause in **${f.name}**'s contract!\n\nShe has accepted their contract offer and immediately transferred to their club. The funds have been deposited. Always secure your stars with larger buyouts!`,
                                        "danger"
                                    );
                                }
                                gs.addNews("transfer", `💣 SHOCK POACH: ${predator.name} triggers the $${rc.toLocaleString()} buyout clause to steal ${f.name} from ${pclub.name}!`);
                            }
                        }
                    }
                }
            });
        }
    },

    _runAIClubLogic(club) {
        const gs = window.GameState;

        // --- 1. Ensure defaults ---
        if (!club.facilities) club.facilities = { gym: 1, recovery: 1, pr: 1 };
        if (club.money === undefined) club.money = 100000;
        if (!club.staff) club.staff = {};

        // --- 2. Smart Training (use TrainingEngine-style logic) ---
        this._runAITraining(club);

        // --- 3. Smart Roster Management: sell excess OR fitness-list willing fighters ---
        this._runAIRosterManagement(club);

        // --- 4. Weekly sponsor income ---
        this._runAISponsorIncome(club);

        // --- 4.5. The Underground Risk ---
        this._runAIUndergroundLogic(club);

        // --- 4.6. Roster Guard (FM-style emergency hiring) ---
        this._ensureMinimumRoster(club);

        // --- 5. Weekly recovery pass ---
        let recLevel = club.facilities?.recovery || 1;
        let healAmount = 5 + (recLevel * 2);
        let pCond = club.staff?.['conditioning_coach'];
        let pPsych = club.staff?.['psych_coach'];
        let extraFatigueHeal = (pCond && gs.staff[pCond]?.passive_bonus?.fatigue_drain_reduction) ? 5 : 0;
        let stressHeal = 2 + ((pPsych && gs.staff[pPsych]?.passive_bonus?.stress_drain_reduction) ? 5 : 0);
        healAmount += extraFatigueHeal;

        club.fighter_ids.forEach(id => {
            let f = gs.getFighter(id);
            if (f) {
                let scarPenalty = (f.dynamic_state.scarred_weeks > 0) ? 0.5 : 1.0;
                if (f.dynamic_state.scarred_weeks > 0) f.dynamic_state.scarred_weeks--;
                f.dynamic_state.fatigue = Math.max(0, f.dynamic_state.fatigue - Math.floor(healAmount * scarPenalty));
                f.dynamic_state.stress = Math.max(0, f.dynamic_state.stress - Math.floor(stressHeal * scarPenalty));
            }
        });
    },

    // ─── NPC TRAINING ────────────────────────────────────────────────────────
    /**
     * FM-style passive training for NPC clubs each week.
     * Intensity is persona-driven. Uses the same intensity table as TrainingEngine.
     */
    _runAITraining(club) {
        const gs = window.GameState;
        const intensityByPersona = {
            big_spender: 7,
            talent_developer: 9,
            brand_first: 4,
            tactician: 7,
            saboteur: 3,
            balanced: 6
        };
        const intensity = intensityByPersona[club.ai_persona || 'balanced'] || 6;

        const intensityTable = {
            1: { minG: 0, maxG: 0, fatigue: -20, injPct: 0.0 },
            2: { minG: 0, maxG: 1, fatigue: 5, injPct: 0.5 },
            3: { minG: 0, maxG: 1, fatigue: 8, injPct: 0.5 },
            4: { minG: 1, maxG: 2, fatigue: 10, injPct: 1.0 },
            5: { minG: 1, maxG: 2, fatigue: 12, injPct: 2.0 },
            6: { minG: 1, maxG: 3, fatigue: 15, injPct: 2.5 },
            7: { minG: 2, maxG: 3, fatigue: 18, injPct: 5.0 },
            8: { minG: 2, maxG: 4, fatigue: 22, injPct: 6.0 },
            9: { minG: 3, maxG: 4, fatigue: 28, injPct: 10.0 },
            10: { minG: 3, maxG: 5, fatigue: 32, injPct: 14.0 }
        };
        const tbl = intensityTable[intensity];
        const gymLevel = club.facilities?.gym || 1;
        const gymMult = [1.0, 1.0, 1.2, 1.4, 1.7][Math.min(gymLevel, 4)];

        // Staff head coach bonus
        let staffBonus = 0;
        const hcId = club.staff?.['head_coach'];
        if (hcId && gs.staff[hcId]?.passive_bonus?.all_training_gain) {
            staffBonus += gs.staff[hcId].passive_bonus.all_training_gain;
        }

        const focusPools = [
            ['power', 'technique', 'speed', 'control', 'endurance'],  // general A
            ['technique', 'composure', 'speed'],                        // technical
            ['power', 'aggression'],                                    // power
            ['resilience', 'endurance']                                 // conditioning
        ];

        club.fighter_ids.forEach(id => {
            const f = gs.getFighter(id);
            if (!f) return;

            const fat = f.dynamic_state.fatigue;
            // Skip very exhausted fighters
            if (fat > 80) return;

            const effMult = fat <= 30 ? 1.0 : fat <= 60 ? 0.65 : 0.30;
            const pool = focusPools[Math.floor(Math.random() * focusPools.length)];
            const stat = pool[Math.floor(Math.random() * pool.length)];
            const pa = f.potential || f.natural_ceiling || 80;
            const current = f.core_stats[stat] || 0;
            const headroom = pa - current;

            if (headroom > 0) {
                const headMult = Math.max(0.05, Math.min(1.0, headroom / 25));
                const raw = tbl.minG + Math.random() * (tbl.maxG - tbl.minG);
                let gain = Math.floor(raw * effMult * gymMult * headMult + staffBonus);
                gain = Math.max(0, Math.min(gain, headroom));
                f.core_stats[stat] = Math.min(pa, current + gain);
            }

            // Fatigue
            f.dynamic_state.fatigue = Math.max(0, Math.min(100, fat + tbl.fatigue));

            // Injury roll (only if high fatigue)
            if (f.dynamic_state.fatigue > 75 && Math.random() * 100 < tbl.injPct) {
                this._inflictAITrainingInjury(f, gs);
            }
        });
    },

    _inflictAITrainingInjury(f, gs) {
        const injuries = [
            { name: 'Muscle Strain', duration: 1, severity: 'Minor' },
            { name: 'Sprained Wrist', duration: 2, severity: 'Minor' },
            { name: 'Hamstring Pull', duration: 2, severity: 'Moderate' },
            { name: 'Rib Bruising', duration: 3, severity: 'Moderate' }
        ];
        const inj = injuries[Math.floor(Math.random() * injuries.length)];
        if (!f.dynamic_state.injuries) f.dynamic_state.injuries = [];
        f.dynamic_state.injuries.push({ ...inj });
        f.dynamic_state.stress = Math.min(100, (f.dynamic_state.stress || 0) + 15);
        gs.addNews('injury', `⚠️ ${f.name} (${gs.getClub(f.club_id)?.name || '?'}) picked up a ${inj.name} in training — ${inj.duration} week(s) out.`);
    },

    // ─── NPC ROSTER MANAGEMENT ───────────────────────────────────────────────
    /**
     * 1. If over 8 fighters, list the weakest.
     * 2. If a fighter is unhappy/restless, proactively list them (FM-style).
     */
    _runAIRosterManagement(club) {
        const gs = window.GameState;
        if (!gs.listedForTransfer) gs.listedForTransfer = [];

        // Safety: Don't list anyone if we already have a tiny squad
        if (club.fighter_ids.length <= 2) return;

        // --- A. Excess roster (8+): sell weakest ---
        if (club.fighter_ids.length >= 8) {
            const sorted = club.fighter_ids
                .map(id => gs.getFighter(id)).filter(Boolean)
                .sort((a, b) => {
                    const aOvr = (a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3;
                    const bOvr = (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3;
                    return aOvr - bOvr;
                });
            const weakest = sorted[0];
            if (weakest && !weakest.transfer_listed) {
                const fee = Math.floor(((weakest.core_stats.power + weakest.core_stats.technique + weakest.core_stats.speed) / 3) * 600);
                gs.listedForTransfer.push({ fighterId: weakest.id, listedOnWeek: gs.week, askingFee: fee, listedBy: club.id });
                weakest.transfer_listed = true;
                gs.addNews('transfer', `📋 ${club.name} has listed ${weakest.name} for transfer (squad rotation).`);
            }
        }

        // --- B. Fighter-initiated listing: restless/wants_out fighters ---
        // Only runs ~5% of weeks to avoid flooding the global list
        if (Math.random() > 0.05) return;

        club.fighter_ids.forEach(id => {
            const f = gs.getFighter(id);
            if (!f || f.transfer_listed || !f.contract) return;

            // Reuse the willingness scorer from AITransfers
            const w = window.AITransfers ? window.AITransfers._computeFighterWillingness(f) : null;
            if (!w) return;

            // 'wants_out': fighter demands to be listed (club obliges to avoid unrest)
            // 'restless':  club proactively lists if contract is also in final year
            const finalYear = f.contract.seasons_remaining <= 1;
            let shouldList = false;
            let reason = '';

            if (w.level === 'wants_out') {
                shouldList = true;
                reason = w.reasons[0] || 'unhappy';
            } else if (w.level === 'restless' && finalYear) {
                shouldList = Math.random() < 0.15; // 15% chance to list rather than hold
                reason = 'final contract year & restless';
            }

            if (shouldList) {
                const ovr = (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3;
                const fee = Math.floor(ovr * 800); // slight premium over "sell" price

                // Don't double-list
                const alreadyListed = gs.listedForTransfer.find(l => l.fighterId === f.id);
                if (!alreadyListed) {
                    gs.listedForTransfer.push({ fighterId: f.id, listedOnWeek: gs.week, askingFee: fee, listedBy: club.id });
                    f.transfer_listed = true;
                    gs.addNews('transfer', `🔁 ${f.name} has been made available for transfer by ${club.name} (${reason}).`);
                }
            }
        });
    },

    // AI Clubs occasionally risk their fighters in the Underground for cash
    _runAIUndergroundLogic(club) {
        const gs = window.GameState;
        if (!window.UndergroundEngine) return;

        // Base 5% chance, goes up to 25% if they are broke
        let riskChance = 0.05;
        if (club.money < 20000) riskChance = 0.25;
        if (club.persona === 'Aggressive') riskChance += 0.10;
        if (club.persona === 'Conservative') riskChance -= 0.04;

        if (Math.random() < riskChance && club.fighter_ids.length > 0) {
            // Find a healthy fighter not currently injured
            let available = club.fighter_ids.map(id => gs.getFighter(id))
                .filter(f => f && f.dynamic_state.health > 85 && !f.dynamic_state.injuries?.length);

            if (available.length > 0) {
                // Pick one randomly
                let chosen = available[Math.floor(Math.random() * available.length)];

                // AI generates a random underground opponent (Tier 1 or 2)
                let opp = window.UndergroundEngine.generateFighter(Math.random() < 0.7 ? 1 : 2);

                // Run an instant match (but from the AI club's perspective)
                let res = window.UndergroundEngine.simAITournamentMatch(chosen, opp);

                let aiWon = res.winner.id === chosen.id;

                if (aiWon) {
                    club.money += opp.payout_base;
                    chosen.dynamic_state.stress = Math.min(100, chosen.dynamic_state.stress + 5);
                } else {
                    chosen.dynamic_state.stress = Math.min(100, chosen.dynamic_state.stress + 20);
                }

                // Cruelty and severe injury logic is automatically handled by the engine's mercy phase logic 
                // which was embedded inside simAITournamentMatch. 
            }
        }
    },

    _simulateGhostMatch(m) {
        const gs = window.GameState;
        let pFighterId = m.home === gs.playerClubId ? m.homeFighter : m.awayFighter;

        // If player match hasn't been played, we can't ghost it yet (handled by UI flow)
        if (m.home === gs.playerClubId || m.away === gs.playerClubId) {
            if (!m.winnerId) return; // Wait for player
        }

        // For pure AI vs AI:
        if (!m.winnerId) {
            let hClub = gs.getClub(m.home);
            let aClub = gs.getClub(m.away);

            if (!hClub || !aClub) return;

            // Smart AI Selection: style affinity + OVR + rotation + rivalry awareness
            const getSmartFighter = (club, matchStyle, opponentClub) => {
                // Step 1: filter out injured and exhausted fighters
                let available = club.fighter_ids.map(id => gs.getFighter(id)).filter(f => {
                    if (!f) return false;
                    if (f.dynamic_state.injuries && f.dynamic_state.injuries.length > 0) return false;
                    if (f.dynamic_state.fatigue > 80) return false;
                    return true;
                });

                // Fallback: if everyone is injured/exhausted, use anyone with lowest fatigue
                if (available.length === 0) available = club.fighter_ids.map(id => gs.getFighter(id)).filter(Boolean);

                // (Removed the Strict Rookie Veto System, let the true OVR + Style Affinity algorithm evaluate everyone natively)

                // Step 2: score each available fighter
                const scoreFighter = (id) => {
                    let f = gs.getFighter(id);
                    if (!f) return -999;

                    let score = 0;

                    // Calculate True OVR across all core combat stats for a fully accurate baseline
                    let totalStats = f.core_stats.power + f.core_stats.technique + f.core_stats.speed + f.core_stats.control + f.core_stats.endurance + f.core_stats.resilience + f.core_stats.aggression + f.core_stats.composure + f.core_stats.presence;
                    let trueOvr = totalStats / 9;
                    score += trueOvr * 1.0;

                    // Evaluate Match Style Affinity (Heavily increased weight to encourage specialists)
                    const styleMap = {
                        'boxing': 'boxing',
                        'naked_wrestling': 'naked_wrestling',
                        'catfight': 'catfight',
                        'sexfight': 'sexfight',
                        'kickboxing': 'kickboxing',
                        'submission': 'submission'
                    };
                    let affinityKey = styleMap[matchStyle];
                    let affinity = 50;
                    if (affinityKey && f.style_affinities) {
                        affinity = f.style_affinities[affinityKey] || 50;
                    }

                    // Add standard affinity curve
                    score += affinity * 0.6; // Previously 0.15 (massively undervalued)

                    // Elite Mastery Buff detection
                    // In sim_engine, 90+ affinity grants a massive 10% global stat boost. AI must recognize this!
                    if (affinity >= 90) {
                        score += (trueOvr * 0.3); // Massive valuation jump to prioritize sending Elite Masters
                    }

                    // Fatigue Penalty (fresher fighters score higher)
                    let fatigue = f.dynamic_state.fatigue || 0;
                    score -= fatigue * 0.6;

                    // Form bonus (win streaks carry momentum)
                    let streak = f.dynamic_state.win_streak || 0;
                    score += Math.min(streak * 2, 10);

                    // Rivalry boost — if this fighter has a bitter rival in the opponent club,
                    // she is highly motivated to fight (simulates psychological stakes)
                    if (opponentClub) {
                        opponentClub.fighter_ids.forEach(oppId => {
                            if (window.RelationshipEngine) {
                                let rel = window.RelationshipEngine.getRelationship(f.id, oppId);
                                if (rel && (rel.type === 'bitter_rivals' || rel.type === 'rivalry' || rel.type === 'friction')) {
                                    score += trueOvr * 0.15;
                                }
                            }
                        });
                    }

                    // High ego fighters constantly demand high-profile spotlight matches
                    if (f.dynamic_state.ego === 'High') score += 5;

                    return score;
                };

                // Step 3: sort by score, pick the top scorer
                if (!available || available.length === 0) return null;
                available.sort((a, b) => scoreFighter(b.id) - scoreFighter(a.id));
                return available[0].id;
            };

            m.homeFighter = getSmartFighter(hClub, m.style, aClub);
            m.awayFighter = getSmartFighter(aClub, m.style, hClub);
        }

        // If it's a player match that has been played, or an AI match where fighters were selected
        if (!m.homeFighter || !m.awayFighter) {
            console.warn("Ghost match forfeit: One or both clubs could not field a fighter (possibly due to empty roster). Awarding 5-0 win.");
            // Award 5-0 win to the club that has a fighter. If both are empty, it's a 0-0 void.
            if (m.homeFighter && !m.awayFighter) {
                m.winnerId = m.homeFighter;
                m.rounds = { f1: 5, f2: 0 };
            } else if (!m.homeFighter && m.awayFighter) {
                m.winnerId = m.awayFighter;
                m.rounds = { f1: 0, f2: 5 };
            } else {
                m.winnerId = null;
                m.rounds = { f1: 0, f2: 0 };
            }
            return;
        }

        let hf = window.GameState.getFighter(m.homeFighter);
        let af = window.GameState.getFighter(m.awayFighter);

        let sim = new MatchSimulation(hf, af, m.style, false);
        sim.startMatch();
        while (!sim.winner) {
            sim.playRound();
        }

        // Record winner
        m.winnerId = sim.winner.id;
        m.rounds = sim.roundsWon;

        // Sponsor per-match payout (applies when player club is in this ghost match)
        if (window.UISponsors) {
            const winnerClubId = window.GameState.getFighter(sim.winner.id)?.club_id;
            window.UISponsors.collectMatchPayout(m, winnerClubId === window.GameState.playerClubId);
        }

        // --- FM-Style AI Ticket Revenue ---
        if (m.home !== window.GameState.playerClubId && hf && af) {
            let hClub = window.GameState.getClub(m.home);
            if (hClub) {
                let hfOvr = (hf.core_stats.power + hf.core_stats.technique + hf.core_stats.speed) / 3;
                let afOvr = (af.core_stats.power + af.core_stats.technique + af.core_stats.speed) / 3;
                let matchFame = (hf.dynamic_state.fame || (hfOvr * 15)) + (af.dynamic_state.fame || (afOvr * 15));

                let ticketSales = Math.floor(matchFame * 12);
                let prMult = 1.0 + ((hClub.facilities?.pr || 1) - 1) * 0.15;
                hClub.money = (hClub.money || 0) + Math.floor(ticketSales * prMult);
            }
        }

        // Apply global post-match streaks
        if (window.SimEvents) {
            let gRoundDiff = Math.abs((sim.roundsWon?.f1 || 0) - (sim.roundsWon?.f2 || 0));
            let loserId = sim.winner.id === hf.id ? af.id : hf.id;
            window.SimEvents.processPostMatch(sim.winner.id, loserId, gRoundDiff, m.style);
        }

        // Post-match fatigue AND injury rolls for NPC fighters
        hf.dynamic_state.fatigue = Math.min(100, (hf.dynamic_state.fatigue || 0) + 15);
        af.dynamic_state.fatigue = Math.min(100, (af.dynamic_state.fatigue || 0) + 15);
        this._runAIMatchInjury(hf);
        this._runAIMatchInjury(af);

        console.log(`Ghost Match Result: ${hf.name} vs ${af.name} | Winner: ${sim.winner.name}`);

        // News
        window.GameState.addNews('match', `${window.GameState.getClub(m.home).name} vs ${window.GameState.getClub(m.away).name}: ${sim.winner.name} takes the victory in ${m.style}!`);
    },

    _advanceTime() {
        const gs = window.GameState; // FIX: must be declared before any use below
        this._updateStandings();
        if (window.AITransfers) window.AITransfers.processAITransfersWeekly();
        gs.week++;
        gs.undergroundAvailableThisWeek = true;

        // Passive Training — runs every week for player club fighters
        if (window.TrainingEngine) window.TrainingEngine.processWeeklyTraining();

        // Relationship bond bonuses — partner morale boost, best-friend morale, injured-friend stress
        if (window.RelationshipEngine) window.RelationshipEngine.applyWeeklyBonds(gs.playerClubId);

        // Process Contracts (happiness tracking — weekly)
        if (window.ContractEngine) window.ContractEngine.updateAllContracts();

        // Show Season Highlights right after Week 14 ends (Start of Week 15)
        if (gs.week === 15) {
            if (window.UIComponents && window.UIComponents.showSeasonHighlights) {
                window.UIComponents.showSeasonHighlights();
            }
        }

        // Season hard resets after Week 16 (giving 2 weeks of offseason)
        if (gs.week > 16) {
            console.log("=== REGULAR SEASON ENDED ===");
            // Annual wage + upkeep deduction at season end
            if (window.ContractEngine) window.ContractEngine._deductAnnualWages();
            this._calculateSeasonAwards();
            if (window.UISponsors) window.UISponsors.collectSponsorPayout();
            if (window.SeasonEvents) window.SeasonEvents.processEndOfSeason();

            // Inter-Club Rivalry Processing
            if (!gs.clubRivalries) gs.clubRivalries = {};
            gs.schedule.forEach(m => {
                if (m.winnerId && m.rounds) {
                    // BUGFIX: Determine historical club from match record, not current fighter location
                    let wClub = (m.winnerId === m.homeFighter) ? m.home : m.away;
                    let lClub = (wClub === m.home) ? m.away : m.home;
                    if (wClub && lClub) {
                        let pair = [wClub, lClub].sort().join('-');
                        if (!gs.clubRivalries[pair]) gs.clubRivalries[pair] = 0;
                        gs.clubRivalries[pair] += 1;
                        let loserWins = Math.min(m.rounds.f1 || 0, m.rounds.f2 || 0);
                        if (loserWins <= 1) gs.clubRivalries[pair] += 2;
                    }
                }
            });

            if (window.AITransfers) window.AITransfers.handleSeasonEnd();
            if (window.SimAging) window.SimAging.ageWorld();

            // Season-end actions for all clubs
            Object.keys(gs.clubs).forEach(clubId => {
                this._runYouthAcademy(clubId);

                if (clubId === gs.playerClubId) return;

                // Season-end AI actions for NPC clubs
                const club = gs.clubs[clubId];

                // 1. Recalculate Club Fame dynamically
                let totalFame = 0;
                club.fighter_ids.forEach(fid => {
                    let f = gs.getFighter(fid);
                    if (f) {
                        let fOvr = (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3;
                        totalFame += f.dynamic_state.fame || Math.floor(fOvr * 10);
                    }
                });
                let st = gs.leagueStandings.find(s => s.id === club.id);
                if (st && st.w > 0) totalFame += (st.w * 50);
                club.fame = Math.floor(totalFame);

                this._runAIFacilitySpending(club);      // Facility upgrades
                this._runAISponsorSigning(club);         // Sign/renew a sponsor deal
                this._collectAISponsorSeasonPayout(club); // Collect lump-sum sponsor income
                this._runAIStaffHiring(club);            // Hire staff if slots open
            });

            // ── OVR Snapshot for "Most Improved" Awards ──
            Object.values(gs.fighters).forEach(f => {
                let currentOvr = Math.floor((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                f.history_start_of_season_OVR = currentOvr;
            });

            gs.season++;
            gs.week = 1;

            // Reset Mid-Season Cup for the new year
            gs.midSeasonCupActive = false;
            gs.midSeasonCupCompleted = false;
            gs.midSeasonCup = null;

            // Generate new schedule for the new season
            if (window.SimSchedule) window.SimSchedule.generateSeasonSchedule();

            console.log("=== NEW SEASON STARTING ===");
            alert(`Season ${gs.season} begins! Retiring fighters have left, and new prospects have entered the pool.`);

            // Re-render UI
            if (window.Router.currentRoute === 'club') {
                window.Router.loadRoute('club');
            }
        }

        // Process Healing & Injuries for all fighters
        Object.keys(gs.fighters).forEach(id => {
            let f = gs.getFighter(id);
            if (!f) return;

            let club = gs.getClub(f.club_id);

            // Base heals
            let healAmount = 5;
            let stressHeal = 2;
            let hasRehab = false;

            if (club) {
                // Facility bonus
                let recLevel = club.facilities?.recovery || 1;
                healAmount += (recLevel * 2);

                // Staff bonuses
                if (club.staff) {
                    Object.values(club.staff).forEach(staffId => {
                        let s = gs.staff[staffId];
                        if (s) {
                            if (s.passive_bonus.fatigue_drain_reduction) healAmount += 5;
                            if (s.passive_bonus.stress_drain_reduction) stressHeal += 5;
                            if (s.trait === 'Rehabilitationist') {
                                hasRehab = true;
                                stressHeal += 8; // Active trait: deep stress healing
                            }
                        }
                    });
                }
            }

            f.dynamic_state.fatigue = Math.max(0, f.dynamic_state.fatigue - healAmount);
            f.dynamic_state.stress = Math.max(0, f.dynamic_state.stress - stressHeal);

            // Process Injuries
            if (f.dynamic_state.injuries && f.dynamic_state.injuries.length > 0) {
                // Decrease duration by 1 week, or 2 weeks if Rehab is present and they get a lucky tick
                f.dynamic_state.injuries.forEach(i => {
                    i.duration -= 1;
                    if (hasRehab && Math.random() < 0.35) i.duration -= 1; // 35% chance to heal an extra week
                });

                // Filter out healed injuries
                let oldLen = f.dynamic_state.injuries.length;
                f.dynamic_state.injuries = f.dynamic_state.injuries.filter(i => i.duration > 0);

                if (f.dynamic_state.injuries.length < oldLen && f.club_id === gs.playerClubId) {
                    gs.addNews('global', `${f.name} has recovered from her injury and is cleared to fight.`);
                }
            }
        });

        // Restore player AP
        window.GameState.actionPoints = window.GameState.maxActionPoints;

        // Refresh UI
        if (typeof updateNavUI === 'function') updateNavUI();
    },

    _updateStandings() {
        const gs = window.GameState;

        // Initialize if empty
        if (gs.leagueStandings.length === 0) {
            gs.leagueStandings = Object.values(gs.clubs).map(c => ({
                id: c.id, name: c.name, color: c.color,
                played: 0, w: 0, l: 0, pts: 0, rw: 0, rl: 0, rd: 0
            }));
        }

        // Reset points to recalculate based on played matches
        gs.leagueStandings.forEach(st => { st.played = 0; st.w = 0; st.l = 0; st.pts = 0; st.rw = 0; st.rl = 0; st.rd = 0; });

        let pastMatches = gs.schedule.filter(m => m.week <= gs.week && m.winnerId && m.rounds !== null);

        pastMatches.forEach(m => {
            // BUGFIX: Do not look up the fighter's CURRENT club_id, as they may have transferred mid-season!
            // Instead, derive the historically accurate winning club directly from the match record.
            let winClubId = (m.winnerId === m.homeFighter) ? m.home : m.away;
            let loseClubId = (winClubId === m.home) ? m.away : m.home;

            // MatchSimulation stores rounds as { f1: 5, f2: X }
            let winnerRoundsWon = 5;
            let loserRoundsWon = 0;
            if (m.rounds) {
                if (typeof m.rounds.f1 !== 'undefined') {
                    loserRoundsWon = Math.min(m.rounds.f1, m.rounds.f2);
                } else if (Array.isArray(m.rounds)) {
                    loserRoundsWon = Math.max(0, m.rounds.length - 5);
                }
            } else {
                loserRoundsWon = Math.floor(Math.random() * 4); // Fallback if simple ghost match
            }

            let wSt = gs.leagueStandings.find(s => s.id === winClubId);
            let lSt = gs.leagueStandings.find(s => s.id === loseClubId);

            if (wSt) {
                wSt.played++;
                wSt.w++;
                wSt.pts += 2; // 2 Points per Win
                wSt.rw += 5; // Winner always gets 5
                wSt.rl += loserRoundsWon;
            }
            if (lSt) {
                lSt.played++;
                lSt.l++;
                lSt.rl += 5; // Loser loses 5
                lSt.rw += loserRoundsWon; // Loser wins what they managed to scrap
            }
        });

        // Calculate RD
        gs.leagueStandings.forEach(st => { st.rd = st.rw - st.rl; });

        // Sort standings: Pts primary, RD secondary, RW tertiary
        gs.leagueStandings.sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            if (b.rd !== a.rd) return b.rd - a.rd;
            return b.rw - a.rw;
        });
    },

    _calculateSeasonAwards() {
        const gs = window.GameState;
        let pFighters = Object.values(gs.fighters).filter(f => f.club_id); // Only active fighters
        if (pFighters.length === 0) return;

        // Fighter of the Season (highest form + morale)
        let mvp = pFighters.reduce((a, b) => (a.dynamic_state.form + a.dynamic_state.morale) > (b.dynamic_state.form + b.dynamic_state.morale) ? a : b);

        // Breakthrough Rookie (Youngest high performer, under 23)
        let rookies = pFighters.filter(f => f.age <= 23);
        let rookie = rookies.length > 0 ? rookies.reduce((a, b) => a.dynamic_state.form > b.dynamic_state.form ? a : b) : null;

        // Most Dominant (Highest average stats among active)
        let dominant = pFighters.reduce((a, b) => {
            let aScore = a.core_stats.power + a.core_stats.technique + a.core_stats.speed;
            let bScore = b.core_stats.power + b.core_stats.technique + b.core_stats.speed;
            return aScore > bScore ? a : b;
        });

        // Apply awards
        gs.addNews('global', `🏆 **Season ${gs.season} Awards** 🏆`);

        // League Finishers
        if (gs.leagueStandings && gs.leagueStandings.length > 0) {
            const prizeMoney = [200000, 150000, 100000, 75000, 50000, 40000, 30000, 20000];
            gs.leagueStandings.forEach((st, index) => {
                let club = gs.getClub(st.id);
                if (club) {
                    let prize = prizeMoney[index] || 10000;
                    if (st.id === gs.playerClubId) {
                        gs.money += prize;
                    } else {
                        club.money = (club.money || 0) + prize;
                    }
                }
            });

            let champ = gs.leagueStandings[0];
            let runner = gs.leagueStandings[1] || champ;

            gs.fame += (champ.id === gs.playerClubId) ? 2000 : (runner.id === gs.playerClubId ? 800 : 0);
            gs.addNews('global', `**League Champions**: ${gs.getClub(champ.id).name} takes the crown!`);

            if (window.SeasonEvents) {
                let champClub = gs.getClub(champ.id);
                if (champClub) {
                    if (!champClub.championships) champClub.championships = 0;
                    champClub.championships += 1;

                    if (champClub.fighter_ids.length > 0) {
                        let topFighter = champClub.fighter_ids.map(id => gs.getFighter(id)).reduce((a, b) => (a.record ? a.record.w : 0) > (b.record ? b.record.w : 0) ? a : b);
                        if (topFighter) window.SeasonEvents.processChampionship(topFighter.id);
                    }
                }
            }
        }

        // MVP
        mvp.core_stats.presence = Math.min(100, mvp.core_stats.presence + 10);
        mvp.dynamic_state.fame = (mvp.dynamic_state.fame || 0) + 500;
        if (mvp.club_id === gs.playerClubId) gs.money += 10000;
        gs.addNews('global', `**Fighter of the Season**: ${mvp.name} (${gs.getClub(mvp.club_id).name}) wins the top prize!`);

        // Rookie
        if (rookie) {
            rookie.dynamic_state.morale = 100;
            rookie.dynamic_state.fame = (rookie.dynamic_state.fame || 0) + 300;
            if (rookie.club_id === gs.playerClubId) gs.money += 5000;
            gs.addNews('global', `**Breakthrough Fighter**: ${rookie.name} (${gs.getClub(rookie.club_id).name}) shocked the world this year.`);
        }

        // Dominant
        dominant.core_stats.aggression = Math.min(100, dominant.core_stats.aggression + 5);
        gs.addNews('global', `**Most Dominant**: ${dominant.name} (${gs.getClub(dominant.club_id).name}) struck fear into the league.`);

        // Fan Appreciation Bonus
        let pClub = gs.getClub(gs.playerClubId);
        let fanAppreciation = 0;
        pClub.fighter_ids.forEach(id => {
            let f = gs.getFighter(id);
            if (f && f.dynamic_state.fame > 80) fanAppreciation += 500;
            else if (f && f.core_stats.presence >= 80) fanAppreciation += 500; // fallback proxy if fame tracking is new
        });

        if (fanAppreciation > 0) {
            gs.money += fanAppreciation;
            gs.addNews('finance', `Collected $${fanAppreciation.toLocaleString()} in end-of-season Fan Appreciation bonuses.`);
        }
    },

    // ─── NPC POST-MATCH INJURY ────────────────────────────────────────────────
    /**
     * Rolls a match-inflicted injury for an NPC fighter.
     * Risk scales with fatigue — mirrors what happens to player fighters.
     */
    _runAIMatchInjury(fighter) {
        if (!fighter) return;
        const fatigue = fighter.dynamic_state.fatigue || 0;
        // Base 5% chance, scales up to 22% at max fatigue
        const injuryChance = 0.05 + (fatigue / 100) * 0.17;
        if (Math.random() > injuryChance) return;

        const injuries = [
            { name: 'Bruised Ribs', duration: 1, severity: 'Minor' },
            { name: 'Strained Shoulder', duration: 2, severity: 'Minor' },
            { name: 'Concussion (mild)', duration: 2, severity: 'Moderate' },
            { name: 'Knee Twist', duration: 3, severity: 'Moderate' },
            { name: 'Cheekbone Fracture', duration: 4, severity: 'Serious' }
        ];
        const inj = injuries[Math.floor(Math.random() * injuries.length)];
        if (!fighter.dynamic_state.injuries) fighter.dynamic_state.injuries = [];
        fighter.dynamic_state.injuries.push({ ...inj });
        fighter.dynamic_state.stress = Math.min(100, (fighter.dynamic_state.stress || 0) + 20);

        const gs = window.GameState;
        const clubName = gs.getClub(fighter.club_id)?.name || '?';
        gs.addNews('injury', `🩹 ${fighter.name} (${clubName}) suffered a ${inj.name} during the match — ${inj.duration} week(s) out.`);
    },

    // ─── NPC SPONSOR AI ────────────────────────────────────────────────────────
    /**
     * At season end, each NPC club signs the best sponsor they qualify for.
     * Persona influences which tier they prefer.
     */
    _runAISponsorSigning(club) {
        const gs = window.GameState;
        if (!club.money) club.money = 100000;
        if (!club.fame) club.fame = 0;
        if (!club.facilities) club.facilities = { gym: 1, recovery: 1, pr: 1 };

        // Skip if holding an active, non-expired contract
        if (club.sponsorContract) {
            const expiresAfter = club.sponsorContract.signedSeason + club.sponsorContract.durationYears - 1;
            if ((gs.season || 1) <= expiresAfter) return;
            // Contract expired — null it and fall through to sign a new one
            club.sponsor = null;
            club.sponsorContract = null;
        }

        // Inline sponsor catalogue (mirrors UISponsors._catalogue without UI deps)
        const catalogue = [
            { id: 'local_dojo', tier: 'bronze', type: 'lump_sum', baseAmount: 36000, perWin: 0, durationYears: 1, fameRequired: 0, prRequired: 1, name: 'Local Dojo Network' },
            { id: 'profight_supplements', tier: 'bronze', type: 'per_match', baseAmount: 5400, perWin: 0, durationYears: 1, fameRequired: 0, prRequired: 1, name: 'ProFight Supplements' },
            { id: 'city_sports_bar', tier: 'bronze', type: 'win_bonus', baseAmount: 7500, perWin: 0, durationYears: 1, fameRequired: 0, prRequired: 1, name: 'City Sports Bar' },
            { id: 'iron_jaw_gear', tier: 'bronze', type: 'per_match', baseAmount: 6300, perWin: 0, durationYears: 1, fameRequired: 0, prRequired: 1, name: 'Iron Jaw Gear' },
            { id: 'street_king_energy', tier: 'bronze', type: 'lump_sum', baseAmount: 42000, perWin: 0, durationYears: 1, fameRequired: 50, prRequired: 1, name: 'Street King Energy' },

            { id: 'underground_media', tier: 'silver', type: 'lump_sum', baseAmount: 105000, perWin: 0, durationYears: 1, fameRequired: 150, prRequired: 2, name: 'Underground Media Hub' },
            { id: 'ironfist_apparel', tier: 'silver', type: 'match_bonus', baseAmount: 6600, perWin: 4500, durationYears: 1, fameRequired: 200, prRequired: 2, name: 'IronFist Apparel' },
            { id: 'obsidian_luxury', tier: 'silver', type: 'lump_bonus', baseAmount: 75000, perWin: 10500, durationYears: 2, fameRequired: 400, prRequired: 2, name: 'Obsidian Luxury Brands' },
            { id: 'combat_logistics', tier: 'silver', type: 'win_bonus', baseAmount: 12000, perWin: 0, durationYears: 1, fameRequired: 250, prRequired: 2, name: 'Combat Logistics' },
            { id: 'neon_nights_club', tier: 'silver', type: 'lump_bonus', baseAmount: 84000, perWin: 6000, durationYears: 2, fameRequired: 300, prRequired: 2, name: 'Neon Nights Club' },

            { id: 'apex_media', tier: 'gold', type: 'lump_sum', baseAmount: 180000, perWin: 0, durationYears: 2, fameRequired: 700, prRequired: 3, name: 'APEX Combat Media' },
            { id: 'global_network', tier: 'gold', type: 'per_match', baseAmount: 15000, perWin: 0, durationYears: 2, fameRequired: 900, prRequired: 3, name: 'Global Combat Network' },
            { id: 'pinnacle_nutrition', tier: 'gold', type: 'match_bonus', baseAmount: 11000, perWin: 6000, durationYears: 2, fameRequired: 1100, prRequired: 4, name: 'Pinnacle Nutrition' },
            { id: 'vect0r_tech', tier: 'gold', type: 'lump_bonus', baseAmount: 250000, perWin: 6500, durationYears: 2, fameRequired: 1400, prRequired: 4, name: 'VECT0R Tech' },
            { id: 'olympus_biotech', tier: 'gold', type: 'lump_sum', baseAmount: 210000, perWin: 0, durationYears: 2, fameRequired: 1000, prRequired: 3, name: 'Olympus Biotech' },
            { id: 'zenith_athletics', tier: 'gold', type: 'match_bonus', baseAmount: 14000, perWin: 9000, durationYears: 2, fameRequired: 1200, prRequired: 4, name: 'Zenith Athletics' }
        ];

        const fame = club.fame || 0;
        const prLevel = club.facilities?.pr || 1;

        // Filter to what the club qualifies for, then pick the best (highest baseAmount)
        const eligible = catalogue.filter(sp => fame >= sp.fameRequired && prLevel >= sp.prRequired);
        if (eligible.length === 0) return;

        // Persona: big_spender & brand_first prefer lump types; talent_developer prefers match types
        const persona = club.ai_persona || 'balanced';
        let preferred = eligible;
        if (persona === 'big_spender' || persona === 'brand_first') {
            const lumpOnly = eligible.filter(sp => sp.type === 'lump_sum' || sp.type === 'lump_bonus');
            if (lumpOnly.length > 0) preferred = lumpOnly;
        } else if (persona === 'talent_developer') {
            const matchOnly = eligible.filter(sp => sp.type === 'match_bonus' || sp.type === 'per_match');
            if (matchOnly.length > 0) preferred = matchOnly;
        }

        // Pick the highest baseAmount from preferred pool
        preferred.sort((a, b) => b.baseAmount - a.baseAmount);
        const chosen = preferred[0];

        club.sponsor = chosen.id;
        club.sponsorContract = { id: chosen.id, signedSeason: gs.season || 1, durationYears: chosen.durationYears, _data: chosen };
        gs.addNews('transfer', `📝 ${club.name} signed a ${chosen.durationYears}-year sponsorship deal with ${chosen.name}!`);
    },

    /**
     * Weekly: apply per-match and win-bonus sponsor income to NPC clubs.
     * Called from _runAIClubLogic each week.
     */
    _runAISponsorIncome(club) {
        const gs = window.GameState;
        if (!club.sponsor || !club.sponsorContract) return;

        const sp = club.sponsorContract._data;
        if (!sp) return;

        const prBonus = 1 + ((club.facilities?.pr || 1) - 1) * 0.25;

        // Count wins this week for this club (matches resolved this week)
        const thisWeekMatches = gs.schedule.filter(m =>
            m.week === gs.week && (m.home === club.id || m.away === club.id) && m.winnerId
        );
        const winsThisWeek = thisWeekMatches.filter(m => {
            const wf = gs.getFighter(m.winnerId);
            return wf && wf.club_id === club.id;
        }).length;
        const matchesThisWeek = thisWeekMatches.length;

        let income = 0;
        switch (sp.type) {
            case 'per_match': income = Math.round(sp.baseAmount * matchesThisWeek * prBonus); break;
            case 'win_bonus': income = Math.round(sp.baseAmount * winsThisWeek * prBonus); break;
            case 'match_bonus': income = Math.round((sp.baseAmount * matchesThisWeek + (sp.perWin || 0) * winsThisWeek) * prBonus); break;
            case 'lump_bonus': income = Math.round((sp.perWin || 0) * winsThisWeek * prBonus); break;
            // lump_sum: handled at season-end only
        }

        if (income > 0) club.money = (club.money || 0) + income;
    },

    /**
     * Season-end: collect the flat/lump portion of NPC sponsor deals & check expiry.
     */
    _collectAISponsorSeasonPayout(club) {
        const gs = window.GameState;
        if (!club.sponsor || !club.sponsorContract) return;

        const sp = club.sponsorContract._data;
        if (!sp) return;

        const prBonus = 1 + ((club.facilities?.pr || 1) - 1) * 0.25;
        let payout = 0;

        if (sp.type === 'lump_sum') payout = Math.round(sp.baseAmount * prBonus);
        if (sp.type === 'lump_bonus') payout = Math.round(sp.baseAmount * prBonus);

        if (payout > 0) {
            club.money = (club.money || 0) + payout;
            gs.addNews('finance', `💰 ${club.name} collected $${payout.toLocaleString()} lump-sum from ${sp.name}.`);
        }

        // Check expiry
        const expiresAfter = club.sponsorContract.signedSeason + sp.durationYears - 1;
        if ((gs.season || 1) >= expiresAfter) {
            club.sponsor = null;
            club.sponsorContract = null;
            gs.addNews('club', `⚠️ ${club.name}'s deal with ${sp.name} has expired.`);
        }
    },

    // ─── NPC STAFF HIRING ────────────────────────────────────────────────────
    /**
     * At season end, NPC clubs fill empty staff slots if they have the budget.
     * Prefers coaches matching the club's persona and roster needs.
     * Dynamically upgrades existing staff if highly profitable.
     */
    _runAIStaffHiring(club) {
        const gs = window.GameState;
        if (!club.money) club.money = 0;
        if (!club.staff) club.staff = {};
        if (!gs.staffPool || gs.staffPool.length < 5) {
            // Guarantee at least some staff exist, or generate new ones dynamically
            this._generateFallbackStaff(gs);
        }

        // ── MEGA-RICH STAFF POACHING ──
        if (club.money > 1000000 && Math.random() < 0.3) {
            let allExternalStaff = [];
            Object.keys(gs.clubs).forEach(cid => {
                if (cid === club.id) return;
                let c = gs.clubs[cid];
                if (c.staff) {
                    Object.entries(c.staff).forEach(([r, sId]) => {
                        let s = gs.staff[sId];
                        if (s && s.skill >= 80) {
                            allExternalStaff.push({ clubId: cid, role: r, staff: s });
                        }
                    });
                }
            });

            if (allExternalStaff.length > 0) {
                // Pick the best one
                allExternalStaff.sort((a, b) => b.staff.skill - a.staff.skill);
                let target = allExternalStaff[0];
                let currentSalary = target.staff.salary || 15000;
                let offer = currentSalary * 2;

                if (club.money >= offer + 100000) {
                    // Try to poach
                    let poached = false;
                    if (target.clubId === gs.playerClubId) {
                        let match = confirm(`🚨 STAFF POACHING!\n\nMega-rich rival ${club.name} has offered your ${target.role.replace(/_/g, ' ')}, ${target.staff.name} (Level ${target.staff.skill}), a massive salary of $${offer.toLocaleString()}/yr to defect!\n\nDo you want to MATCH this offer to keep them?`);
                        if (match) {
                            gs.money -= (offer - currentSalary);
                            target.staff.salary = offer;
                            gs.addNews('club', `💰 You matched ${club.name}'s massive offer to keep your ${target.role.replace(/_/g, ' ')}, ${target.staff.name}. New salary: $${offer.toLocaleString()}`);
                        } else {
                            poached = true;
                        }
                    } else {
                        // NPC vs NPC - always poaches if the other NPC is poorer
                        let victimClub = gs.clubs[target.clubId];
                        if (victimClub && (victimClub.money || 0) < offer) {
                            poached = true;
                        }
                    }

                    if (poached) {
                        let victimName = target.clubId === gs.playerClubId ? "YOUR club" : gs.getClub(target.clubId).name;
                        gs.addNews('transfer', `🚨 RUTHLESS MOVE: ${club.name} poached elite ${target.role.replace(/_/g, ' ')} ${target.staff.name} away from ${victimName} by offering double salary ($${offer.toLocaleString()})!`);

                        // Execute poach
                        let victimClub = gs.clubs[target.clubId];
                        if (victimClub && victimClub.staff[target.role] === target.staff.id) {
                            delete victimClub.staff[target.role];
                        }

                        // If poaching club already had someone in this role, send them to the pool
                        if (club.staff[target.role]) {
                            gs.staffPool.push(club.staff[target.role]);
                        }

                        club.staff[target.role] = target.staff.id;
                        target.staff.salary = offer;
                        club.money -= offer;
                        return; // Stop further hiring this season to balance
                    }
                }
            }
        }

        const allRoles = ['head_coach', 'striking_coach', 'grapple_coach', 'conditioning_coach', 'psych_coach'];

        // Persona role priority
        const priorityByPersona = {
            talent_developer: ['conditioning_coach', 'head_coach', 'grapple_coach', 'psych_coach', 'striking_coach'],
            tactician: ['head_coach', 'striking_coach', 'grapple_coach', 'psych_coach', 'conditioning_coach'],
            brand_first: ['psych_coach', 'head_coach', 'striking_coach', 'grapple_coach', 'conditioning_coach'],
            big_spender: ['head_coach', 'conditioning_coach', 'striking_coach', 'grapple_coach', 'psych_coach'],
            saboteur: [], // minimal effort
            balanced: allRoles
        };
        let priority = [...(priorityByPersona[club.ai_persona || 'balanced'] || allRoles)];

        // Roster-based prioritization
        let strikeCount = 0;
        let grappleCount = 0;
        if (club.fighter_ids) {
            club.fighter_ids.forEach(fId => {
                let f = gs.getFighter(fId);
                if (f && f.style_affinities) {
                    if (f.style_affinities.boxing + f.style_affinities.catfight > f.style_affinities.naked_wrestling + f.style_affinities.sexfight) {
                        strikeCount++;
                    } else {
                        grappleCount++;
                    }
                }
            });
        }

        if (strikeCount > grappleCount && priority.includes('striking_coach')) {
            priority = ['striking_coach', ...priority.filter(r => r !== 'striking_coach')];
        } else if (grappleCount > strikeCount && priority.includes('grapple_coach')) {
            priority = ['grapple_coach', ...priority.filter(r => r !== 'grapple_coach')];
        }

        // Try to hire or upgrade in priority order
        for (let role of priority) {
            let currentStaffId = club.staff[role];
            let currentSkill = 0;
            if (currentStaffId && gs.staff[currentStaffId]) {
                currentSkill = gs.staff[currentStaffId].skill || 65;
            }

            // Find candidates in the pool for this role
            const candidates = gs.staffPool
                .map(id => gs.staff[id])
                .filter(s => s && s.role === role && s.skill > currentSkill + 4);

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.skill - a.skill); // Best first
                const hire = candidates[0];
                const annualCost = hire.salary || 10000;

                // Decision: Can we afford this?
                // Upgrading an existing slot requires significant cash buffer ($80k surplus)
                // Just filling an empty slot requires the salary + a small $20k buffer
                let canAfford = false;
                if (currentStaffId) {
                    canAfford = club.money >= (annualCost + 80000);
                } else {
                    canAfford = club.money >= (annualCost + 20000);
                }

                if (canAfford) {
                    if (currentStaffId) {
                        gs.staffPool.push(currentStaffId); // Return old staff to pool
                        gs.addNews('club', `🔄 ${club.name} fired their ${role.replace(/_/g, ' ')} to bring in top-tier coaching talent: ${hire.name}!`);
                    } else {
                        gs.addNews('club', `🤝 ${club.name} hired ${hire.name} as their new ${role.replace(/_/g, ' ')}.`);
                    }

                    club.staff[role] = hire.id;
                    club.money -= annualCost;
                    gs.staffPool = gs.staffPool.filter(id => id !== hire.id);
                    break; // Only make one hire per season to spread out budget
                }
            }
        }
    },

    _generateFallbackStaff(gs) {
        const roles = ['head_coach', 'striking_coach', 'grapple_coach', 'conditioning_coach', 'psych_coach'];
        const firstNames = ["Mike", "Sarah", "Greg", "Lisa", "Marcus", "Elena", "Dave", "Maria", "Tom", "Anna", "Jason", "Rebecca"];
        const lastNames = ["Smith", "Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor"];

        for (let i = 0; i < 5; i++) {
            let role = roles[Math.floor(Math.random() * roles.length)];
            let name = firstNames[Math.floor(Math.random() * firstNames.length)] + " " + lastNames[Math.floor(Math.random() * lastNames.length)];
            let skill = 55 + Math.floor(Math.random() * 30); // 55–84
            let isElite = skill >= 78;
            let salary = Math.floor(skill * (isElite ? 500 : 250));

            let id = 'staff_auto_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

            let newStaff = {
                id: id,
                name: name,
                role: role,
                skill: skill,
                salary: salary,
                trait: "Generalist",
                passive_bonus: {},
                generated: true
            };

            if (!gs.staff) gs.staff = {};
            gs.staff[id] = newStaff;
            gs.staffPool.push(id);
        }
    },

    // ─── NPC FACILITY AI ────────────────────────────────────────────────────────
    /**
     * AI clubs invest in facilities once per season based on their persona.
     * Priorities differ by persona type, simulating real club philosophy differences.
     */
    _runAIFacilitySpending(club) {
        if (!club.facilities) club.facilities = { gym: 1, recovery: 1, pr: 1, youth: 1 };
        if (!club.facilities.youth) club.facilities.youth = 1;
        if (club.money === undefined) club.money = 100000;

        const costs = window.FacilityData ? window.FacilityData.costs : {
            gym: [0, 10000, 30000, 80000, 150000, 250000, 400000, 600000, 850000, 1200000, "MAX"],
            recovery: [0, 12000, 36000, 100000, 180000, 300000, 480000, 720000, 1000000, 1500000, "MAX"],
            pr: [0, 8000, 24000, 60000, 120000, 200000, 300000, 450000, 650000, 900000, "MAX"],
            youth: [0, 20000, 50000, 120000, 220000, 350000, 550000, 800000, 1200000, 2000000, "MAX"]
        };

        let wageBill = 0;
        club.fighter_ids.forEach(id => {
            let f = window.GameState.getFighter(id);
            if (f && f.contract) wageBill += f.contract.salary;
        });
        if (club.staff) {
            Object.values(club.staff).forEach(sid => {
                if (sid && window.GameState.staff[sid]) wageBill += window.GameState.staff[sid].salary;
            });
        }

        const canUpgrade = (key) => {
            let level = club.facilities[key] || 1;
            if (level >= 10) return false;
            let cost = costs[key][level];
            let safeBuffer = wageBill + 50000; // Need wages + $50k emergency fund
            return typeof cost === 'number' && club.money >= (cost + safeBuffer);
        };

        const doUpgrade = (key) => {
            let level = club.facilities[key] || 1;
            let cost = costs[key][level];
            if (typeof cost !== 'number' || club.money < cost) return false;
            club.money -= cost;
            club.facilities[key] = level + 1;
            window.GameState.addNews('club', `🏗️ ${club.name} upgraded their ${key.charAt(0).toUpperCase() + key.slice(1)} to Level ${club.facilities[key]}!`);
            return true;
        };

        const doUpgradesForOrder = (order, max) => {
            let upgrades = 0;
            for (let loops = 0; loops < max; loops++) {
                let upgradedThisLoop = false;
                for (let key of order) {
                    if (upgrades >= max) break;
                    if (canUpgrade(key)) {
                        doUpgrade(key);
                        upgrades++;
                        upgradedThisLoop = true;
                    }
                }
                if (!upgradedThisLoop) break;
            }
        };

        const persona = club.ai_persona || 'balanced';

        let loopMax = 2; // Default
        switch (persona) {
            case 'big_spender': loopMax = 4; break;
            case 'talent_developer': loopMax = 3; break;
            case 'brand_first': loopMax = 3; break;
            case 'tactician': loopMax = 3; break;
            case 'saboteur': loopMax = 1; break;
        }

        // FORCE UPGRADES FOR RICH CLUBS
        if (club.money > 1000000) loopMax = 10; // Mega-rich clubs will just buy everything they can
        else if (club.money > 500000) loopMax += 3; // Rich clubs upgrade much faster

        switch (persona) {
            case 'big_spender':
                doUpgradesForOrder(['recovery', 'gym', 'youth', 'pr'], loopMax);
                break;
            case 'talent_developer':
                doUpgradesForOrder(['gym', 'youth', 'recovery', 'pr'], loopMax);
                break;
            case 'brand_first':
                doUpgradesForOrder(['pr', 'recovery', 'youth', 'gym'], loopMax);
                break;
            case 'tactician':
            case 'saboteur':
            case 'balanced':
            default:
                let keysBal = ['gym', 'recovery', 'pr', 'youth'].sort((a, b) => (club.facilities[a] || 1) - (club.facilities[b] || 1));
                doUpgradesForOrder(keysBal, loopMax);
                break;
        }
    },

    _runYouthAcademy(clubId) {
        const gs = window.GameState;
        let club = gs.clubs[clubId];
        if (!club || !club.facilities) return;
        let youthLvl = club.facilities.youth || 1;

        let numProspects = 0;
        let chance = youthLvl * 0.15; // L1 = 15%, L7 = 105%
        while (chance >= 1.0) {
            numProspects++;
            chance -= 1.0;
        }
        if (Math.random() < chance) numProspects++;

        if (numProspects === 0) return;

        for (let i = 0; i < numProspects; i++) {
            let baseStat = 30 + (youthLvl * 2.5) + (Math.random() * 10);
            let ceil = 60 + (youthLvl * 2.5) + (Math.random() * 10);

            let isGenerational = Math.random() < 0.08; // 8% chance for extreme talent
            let isBust = Math.random() < 0.15; // 15% chance for bust

            if (isGenerational) {
                baseStat += 15 + Math.random() * 15;
                ceil = Math.min(100, ceil + 20);
            } else if (isBust) {
                baseStat -= 15 + Math.random() * 10;
                ceil = Math.max(40, ceil - 20);
            }

            let n = (typeof window.GameNames !== 'undefined') ? window.GameNames.generateName() : "Academy Prospect";

            let pf = {
                id: 'youth_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                name: n,
                avatar: `generic/${Math.floor(Math.random() * 490) + 1}.png`,
                age: 18 + Math.floor(Math.random() * 4), // Ages 18-21
                tier: 1,
                core_stats: {
                    power: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    technique: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    speed: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    control: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    endurance: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    resilience: Math.max(10, Math.round(baseStat + Math.random() * 20 - 10)),
                    aggression: Math.max(10, Math.round(40 + Math.random() * 40)),
                    composure: Math.max(10, Math.round(40 + Math.random() * 30)),
                    presence: Math.max(10, Math.round(30 + Math.random() * 30))
                },
                style_affinities: {
                    boxing: Math.round(50 + Math.random() * 30),
                    naked_wrestling: Math.round(50 + Math.random() * 30),
                    catfight: Math.round(50 + Math.random() * 30),
                    sexfight: Math.round(50 + Math.random() * 30)
                },
                personality: {
                    dominance_hunger: Math.round(Math.random() * 100),
                    submissive_lean: Math.round(Math.random() * 30),
                    archetype: ['Brawler', 'Underdog', 'Showboat', 'Technician'][Math.floor(Math.random() * 4)],
                    motivators: [['Money'], ['Loyalty'], ['Glory']][Math.floor(Math.random() * 3)]
                },
                dynamic_state: {
                    form: 60, fatigue: 0, stress: 0, injuries: [], morale: 80, wins: 0, losses: 0,
                    relationships: {}
                },
                natural_ceiling: Math.min(100, Math.round(ceil)),
                potential: Math.min(100, Math.round(ceil))
            };

            gs.fighters[pf.id] = pf;

            pf.club_id = clubId;
            club.fighter_ids.push(pf.id);
            pf.contract = {
                salary: 10000 + (youthLvl * 1000),
                seasons_remaining: 3,
                release_clause: 50000,
                win_bonus: 500,
                happiness: 100,
                demand_triggered: false
            };

            if (clubId === gs.playerClubId) {
                gs.addNews('global', `🎓 The Youth Academy has graduated a new prospect! ${pf.name} joins ${club.name} on a 3-year rookie deal.`);
            }
        }
    },

    _ensureMinimumRoster(club) {
        const gs = window.GameState;
        if (club.fighter_ids.length >= 2) return;

        if (club.money < 10000 && club.fighter_ids.length === 0) {
            club.money += 40000;
            gs.addNews('global', `🏦 FINANCIAL AID: The League has granted ${club.name} a $40,000 stabilization subsidy to prevent bankruptcy.`);
        }

        const pool = (gs.transferPool || []).filter(f => !f.club_id);
        if (pool.length > 0) {
            const affordable = pool.filter(f => {
                const ovr = (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3;
                return club.money >= (ovr * 150);
            });

            if (affordable.length > 0) {
                const pick = affordable.sort((a, b) => {
                    const aOvr = (a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3;
                    const bOvr = (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3;
                    return aOvr - bOvr;
                })[0];

                gs.addNews('transfer', `🆘 EMERGENCY HIRE: ${club.name} signed ${pick.name} on a short-term deal to avoid roster collapse.`);
                pick.club_id = club.id;
                club.fighter_ids.push(pick.id);
                pick.contract = {
                    salary: 12000,
                    seasons_remaining: 1,
                    happiness: 100,
                    win_bonus: 500
                };
                gs.transferPool = gs.transferPool.filter(p => p.id !== pick.id);
                if (club.fighter_ids.length < 2) this._ensureMinimumRoster(club);
                return;
            }
        }

        const n = (typeof window.GameNames !== 'undefined') ? window.GameNames.generateName() : "Local Contender";
        const base = 40 + Math.random() * 10;
        const pf = {
            id: 'emergency_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            name: n + " (New Hire)",
            avatar: `generic/${Math.floor(Math.random() * 490) + 1}.png`,
            age: 18 + Math.floor(Math.random() * 8),
            core_stats: {
                power: Math.round(base), technique: Math.round(base), speed: Math.round(base),
                control: 40, endurance: 40, resilience: 40, aggression: 50, composure: 40, presence: 30
            },
            style_affinities: { boxing: 50, naked_wrestling: 50, catfight: 50, sexfight: 50 },
            personality: { archetype: 'Underdog', dominance_hunger: 50, submissive_lean: 20 },
            dynamic_state: { fatigue: 0, stress: 0, injuries: [], morale: 70, wins: 0, losses: 0 },
            potential: 65,
            club_id: club.id,
            contract: { salary: 8000, seasons_remaining: 1, happiness: 100 }
        };

        gs.fighters[pf.id] = pf;
        club.fighter_ids.push(pf.id);
        gs.addNews('global', `📢 ROSTER GUARD: ${club.name} has promoted a local contender, ${pf.name}, to the main squad to fulfill league roster requirements.`);
        if (club.fighter_ids.length < 2) this._ensureMinimumRoster(club);
    }
};
