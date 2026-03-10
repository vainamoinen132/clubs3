/**
 * ai_transfers.js
 * Generates free agents and handles end-of-season shifts.
 */

window.AITransfers = {

    // ── HELPER: Analyze squad style coverage gaps ──────────────────────────
    // Returns an object indicating which styles the club needs more coverage in
    _getSquadStyleNeeds(club) {
        const gs = window.GameState;
        const styles = ['boxing', 'naked_wrestling', 'catfight', 'sexfight'];
        const coverage = {};
        styles.forEach(s => coverage[s] = 0);

        const fighters = (club.fighter_ids || []).map(id => gs.getFighter(id)).filter(Boolean);
        fighters.forEach(f => {
            const affs = f.style_affinities || {};
            styles.forEach(s => {
                if ((affs[s] || 0) >= 65) coverage[s]++;
            });
        });

        // Identify weak spots: styles with 0-1 capable fighters
        const needs = {};
        styles.forEach(s => {
            needs[s] = coverage[s] <= 1 ? 'high' : coverage[s] <= 2 ? 'medium' : 'low';
        });
        return needs;
    },

    // ── HELPER: Full 9-stat OVR calculation ──────────────────────────────────
    _getFullOvr(f) {
        if (!f || !f.core_stats) return 0;
        const cs = f.core_stats;
        return (cs.power + cs.technique + cs.speed + cs.control + cs.endurance +
            cs.resilience + cs.aggression + cs.composure + cs.presence) / 9;
    },

    handleSeasonEnd() {
        // 0. Execute pending Bosman moves (pre-signed free transfers take effect)
        if (window.UITransfers && window.UITransfers.executeBosmanMoves) {
            window.UITransfers.executeBosmanMoves();
        }

        // 1. Generate new prospects 
        this._generateProspects();

        // 2. Generate new staff
        this._generateStaff();

        // 3. Clear deadpool (optional cleanup later)
    },

    processAITransfersWeekly() {
        const gs = window.GameState;
        if (!gs.transferInbox) gs.transferInbox = [];
        if (!gs.pendingTransferDemands) gs.pendingTransferDemands = [];

        // FM-Style: generate inbox bids for listed fighters (player reviews them)
        this._generateInboxBids();

        // Process transfer demands from unhappy fighters
        this._processTransferDemands();

        if (gs.transferPool.length === 0 && Object.keys(gs.clubs).every(id => id === gs.playerClubId || gs.clubs[id].fighter_ids.length >= 6)) return;

        // Evaluate Free Agent Bidding Wars FIRST (so richest clubs get first pick)
        if (gs.transferPool.length > 0) {
            // Sort pool by expected potential & fame (the FM "wonderkid" filter)
            let topTargets = [...gs.transferPool].sort((a, b) => {
                let aVal = this._getFullOvr(a);
                let bVal = this._getFullOvr(b);
                return bVal - aVal;
            }).slice(0, 3); // Top 3 targets this week

            targetLoop: for (let target of topTargets) {
                let bidders = [];
                Object.keys(gs.clubs).forEach(cid => {
                    if (cid === gs.playerClubId) return;
                    let c = gs.clubs[cid];
                    if (!c.money) c.money = 100000;
                    if (c.fighter_ids.length >= 8) return;

                    let persona = c.ai_persona || 'balanced';
                    let interest = 0;
                    let targetOvr = this._getFullOvr(target);
                    let targetOvr3 = (target.core_stats.power + target.core_stats.technique + target.core_stats.speed) / 3;

                    // ── PERSONA-DRIVEN INTEREST ──
                    if (persona === 'talent_developer' && target.age <= 22 && (target.potential || 60) > 70) interest += 50;
                    if ((persona === 'big_spender' || persona === 'brand_first') && (targetOvr >= 72 || (target.dynamic_state.fame || 0) > 300)) interest += 50;
                    if (persona === 'tactician' && targetOvr >= 68) interest += 30; // Tacticians want reliable fighters
                    if (targetOvr > 60) interest += 10;

                    // ── WONDERKID BIDDING WARS ──
                    if (target.age <= 21 && targetOvr >= 65 && c.money >= 400000) {
                        interest += 100;
                    }

                    // ── SQUAD STYLE COVERAGE (smart gap-filling) ──
                    const squadNeeds = this._getSquadStyleNeeds(c);
                    const tAffs = target.style_affinities || {};
                    let styleFitBonus = 0;
                    ['boxing', 'naked_wrestling', 'catfight', 'sexfight'].forEach(style => {
                        if ((tAffs[style] || 0) >= 65) {
                            if (squadNeeds[style] === 'high') styleFitBonus += 25;
                            else if (squadNeeds[style] === 'medium') styleFitBonus += 10;
                        }
                    });
                    interest += styleFitBonus;

                    // ── AGE BALANCE: if squad is aging, prefer youth ──
                    const rosterFighters = c.fighter_ids.map(id => gs.getFighter(id)).filter(Boolean);
                    const avgAge = rosterFighters.length > 0 ? rosterFighters.reduce((s, f) => s + (f.age || 25), 0) / rosterFighters.length : 25;
                    if (avgAge > 28 && target.age <= 23) interest += 20;

                    // ── TACTICAL ROSTER CONSTRUCTION (staff synergy) ──
                    if (c.staff) {
                        Object.values(c.staff).forEach(sid => {
                            const s = gs.staff[sid];
                            if (!s) return;
                            if (s.role === 'striking_coach' && (tAffs.boxing || 0) > 60) interest += 15;
                            if (s.role === 'grapple_coach' && (tAffs.naked_wrestling || 0) > 60) interest += 15;
                            if (s.role === 'conditioning_coach' && (target.core_stats.endurance || 50) > 70) interest += 10;
                        });
                    }

                    // PANIC BUY: If roster is critically low (< 4 fighters), bid on almost anyone to fill slots
                    if (c.fighter_ids.length < 4) {
                        interest += 100;
                    }

                    if (interest > 30 && c.money > 60000) {
                        // WEALTH-BASED BIDDING: Rich clubs will authorize massive spending caps
                        let maxCommitment = Math.floor(c.money * 0.4);
                        if (c.money > 500000) maxCommitment = Math.floor(c.money * 0.6); // Rich clubs throw their weight around 
                        bidders.push({ club: c, maxBid: maxCommitment, persona: persona, willUpgrade: false, worstId: null });
                    }
                });

                if (bidders.length > 0) {
                    bidders.sort((a, b) => b.maxBid - a.maxBid);
                    let winner = bidders[0];
                    let baseSalary = 15000 + ((winner.club.fame || 0) * 2);

                    // Bidding war multiplier
                    let multiplier = 1.0 + (bidders.length * 0.15);
                    if (winner.persona === 'big_spender') multiplier += 0.2;
                    let finalSalary = Math.floor(baseSalary * multiplier);

                    // Ensure they aren't bankrupting themselves on one salary
                    if (finalSalary > winner.maxBid) finalSalary = winner.maxBid;

                    winner.club.money -= 10000; // Sign-on fee

                    target.club_id = winner.club.id;
                    target.contract = { salary: finalSalary, seasons_remaining: 3, win_bonus: Math.floor(finalSalary * 0.1), release_clause: finalSalary * 10, happiness: 100, demand_triggered: false };
                    winner.club.fighter_ids.push(target.id);
                    gs.fighters[target.id] = target;

                    let idx = gs.transferPool.findIndex(f => f.id === target.id);
                    if (idx !== -1) gs.transferPool.splice(idx, 1);

                    let warText = bidders.length > 1 ? `after a fierce bidding war with ${bidders.length - 1} other clubs` : `on a free transfer`;
                    gs.addNews("transfer", `✍️ ${winner.club.name} signed highly-rated free agent ${target.name} for $${finalSalary.toLocaleString()}/yr ${warText}.`);
                }
            }
        }

        // Iterate through AI clubs for internal roster management
        Object.keys(gs.clubs).forEach(clubId => {
            if (clubId === gs.playerClubId) return;
            const club = gs.clubs[clubId];
            if (!club.money) club.money = 100000;

            let wageBill = 0;
            club.fighter_ids.forEach(id => {
                let f = gs.getFighter(id);
                if (f && f.contract) wageBill += f.contract.salary;
            });
            if (club.staff) {
                Object.values(club.staff).forEach(sid => {
                    if (sid && gs.staff[sid]) wageBill += gs.staff[sid].salary;
                });
            }

            // 1. FINANCIAL CRISIS: Fire Sale
            if (club.money < wageBill * 0.6 && club.fighter_ids.length > 3) {
                // List the highest earner / dead weight to save the club
                let earners = club.fighter_ids.map(id => gs.getFighter(id)).filter(f => f && f.contract && !f.transfer_listed);
                earners.sort((a, b) => b.contract.salary - a.contract.salary);

                if (earners.length > 0) {
                    let sacrifice = earners[0];
                    sacrifice.transfer_listed = true;
                    let ovr = this._getFullOvr(sacrifice);
                    let fireSaleFee = Math.floor(ovr * 400); // Massive discount

                    if (!gs.listedForTransfer) gs.listedForTransfer = [];
                    gs.listedForTransfer.push({ fighterId: sacrifice.id, listedOnWeek: gs.week, askingFee: fireSaleFee, listedBy: club.id });
                    gs.addNews("transfer", `🚨 FINANCIAL CRISIS: ${club.name} transfer-listed top earner ${sacrifice.name} for a bargain $${fireSaleFee.toLocaleString()} to avoid administration!`);
                }
            }

            // 2. AI firing logic: absolute dead weight / making room for talent
            // If they are rich but have a bloated roster of terrible fighters, fire the worst
            if (club.fighter_ids.length > 5) {
                let worstId = null;
                let worstOvr = 999;
                club.fighter_ids.forEach(fId => {
                    let f = gs.getFighter(fId);
                    if (f) {
                        let isHighPotential = (f.potential > 70) || (f.age < 22 && f.potential > 60);
                        let ovr = this._getFullOvr(f);
                        if (!isHighPotential && ovr < worstOvr) {
                            worstOvr = ovr;
                            worstId = fId;
                        }
                    }
                });

                let worstF = gs.getFighter(worstId);
                // Fire them if they are truly awful (<45 OVR) or morale is dead, provided club has funds to eat any minor losses
                if (worstF && (worstOvr < 45 || worstF.dynamic_state.morale <= 10)) {
                    let remainingSeasons = worstF.contract ? (worstF.contract.seasons_remaining || 1) : 1;
                    let isRookieAcademy = worstF.traits?.includes('academy_product') && worstF.age <= 21;
                    let severance = isRookieAcademy ? 0 : (worstF.contract ? worstF.contract.salary * remainingSeasons : 0);

                    // Proceed only if they can afford severance
                    if (club.money >= severance + 50000) {
                        let wIdx = club.fighter_ids.indexOf(worstId);
                        if (wIdx !== -1) {
                            club.money -= severance;
                            club.fighter_ids.splice(wIdx, 1);
                            worstF.club_id = null;
                            if (worstF.contract) worstF.contract.happiness = 50;
                            gs.transferPool.push(worstF);
                            let newsMsg = isRookieAcademy ? `🗑️ ${club.name} released academy rookie ${worstF.name} on a free transfer.` : `🗑️ ${club.name} has terminated the contract of ${worstF.name} due to poor performance.`;
                            gs.addNews("transfer", newsMsg);
                        }
                    }
                }
            }

            // 3. AI Poaching via Release Clauses (STRATEGIC UPGRADES)
            // Rich clubs actively seek to steal rival stars that fill squad needs
            if (club.fighter_ids.length < 8 && club.money > 250000 && Math.random() < 0.15) {
                let poachTargets = [];
                let highestOvr = Math.max(0, ...club.fighter_ids.map(id => { let f = gs.getFighter(id); return f ? this._getFullOvr(f) : 0; }));
                const poachNeeds = this._getSquadStyleNeeds(club);

                Object.values(gs.fighters).forEach(f => {
                    if (f.club_id && f.club_id !== club.id && !f.retired && f.contract && f.contract.release_clause) {
                        let requiredCash = f.contract.release_clause + 50000;
                        if (club.money > requiredCash) {
                            let fOvr = this._getFullOvr(f);
                            let poachScore = 0;

                            // Raw quality upgrade
                            if (fOvr > highestOvr) poachScore += 40;
                            else if (fOvr > highestOvr - 5) poachScore += 20;

                            // Young star premium
                            if (fOvr > 70 && f.age < 24) poachScore += 30;
                            if ((f.potential || 60) > 80 && f.age <= 22) poachScore += 25;

                            // Style gap filling
                            const fAffs = f.style_affinities || {};
                            ['boxing', 'naked_wrestling', 'catfight', 'sexfight'].forEach(style => {
                                if ((fAffs[style] || 0) >= 70 && poachNeeds[style] === 'high') poachScore += 20;
                            });

                            if (poachScore >= 20) poachTargets.push({ fighter: f, score: poachScore, ovr: fOvr });
                        }
                    }
                });

                if (poachTargets.length > 0) {
                    poachTargets.sort((a, b) => b.score - a.score);
                    let target = poachTargets[0].fighter;
                    let buyout = target.contract.release_clause;

                    if (target.club_id === gs.playerClubId) {
                        // Throw it to the player Poach system
                        if (!gs.pendingPoachEvents) gs.pendingPoachEvents = [];
                        gs.pendingPoachEvents.push({
                            fighterId: target.id,
                            bidderId: club.id,
                            transferFee: buyout,
                            week: gs.week
                        });
                    } else {
                        // NPC-to-NPC immediate poach
                        this._processNPCpoaching(target, club, buyout);
                    }
                }
            }

            // 3.5. AI Purchasing from the Transfer List - SMART, NEED-BASED ONLY
            // Clubs evaluate genuine squad needs before buying. No impulse purchases.
            if (gs.listedForTransfer && gs.listedForTransfer.length > 0 && Math.random() < 0.4) {

                // --- Assess club genuine needs ---
                const rosterFighters35 = club.fighter_ids.map(id => gs.getFighter(id)).filter(Boolean);
                const rosterSize35 = rosterFighters35.length;

                // Need A: Critically short on fighters
                const needsMoreFighters = rosterSize35 < 4;
                // Need B: Replacing own listed fighter
                const hasListedOwn = (gs.listedForTransfer || []).some(l => l.listedBy === club.id);
                // Need C: Squad quality below league average
                const clubAvgOvr35 = rosterSize35 > 0
                    ? rosterFighters35.reduce((sum, f) => sum + this._getFullOvr(f), 0) / rosterSize35
                    : 0;
                const leagueAvgOvr35 = (() => {
                    const avgs = Object.values(gs.clubs).map(c => {
                        const fs35 = (c.fighter_ids || []).map(id => gs.getFighter(id)).filter(Boolean);
                        return fs35.length > 0 ? fs35.reduce((s, f) => s + this._getFullOvr(f), 0) / fs35.length : 0;
                    }).filter(v => v > 0);
                    return avgs.length > 0 ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 65;
                })();
                const needsQualityUpgrade = clubAvgOvr35 < leagueAvgOvr35 - 5;
                // Need D: Aging squad needs fresh blood
                const avgAge35 = rosterSize35 > 0 ? rosterFighters35.reduce((s, f) => s + (f.age || 25), 0) / rosterSize35 : 25;
                const needsYouth = avgAge35 > 29;
                const hasAnyNeed = needsMoreFighters || hasListedOwn || needsQualityUpgrade || needsYouth;

                if (hasAnyNeed || rosterSize35 < 6) {
                    const persona35 = club.ai_persona || 'balanced';
                    const highestOvr35 = rosterSize35 > 0 ? Math.max(...rosterFighters35.map(f => this._getFullOvr(f))) : 0;
                    const lowestOvr35 = rosterSize35 > 0 ? Math.min(...rosterFighters35.map(f => this._getFullOvr(f))) : 0;
                    let bestCandidate35 = null, bestScore35 = -1;

                    gs.listedForTransfer.forEach(listing => {
                        if (listing.listedBy === club.id) return;
                        const f = gs.getFighter(listing.fighterId);
                        if (!f || !f.club_id || f.club_id === club.id) return;
                        if (f.club_id === gs.playerClubId) return;
                        if (rosterSize35 >= 8) return;
                        const fOvr = this._getFullOvr(f);
                        if (club.money < listing.askingFee + wageBill * 0.6) return;
                        if (!needsMoreFighters && fOvr < lowestOvr35 - 5) return;
                        let score = 0;
                        if (needsMoreFighters) score += 40;
                        if (needsQualityUpgrade && fOvr > leagueAvgOvr35) score += 30;
                        if (needsYouth && (f.age || 25) <= 23) score += 25;
                        if (hasListedOwn && fOvr >= lowestOvr35) score += 20;
                        if (fOvr > highestOvr35 - 3) score += 25;
                        else if (fOvr > clubAvgOvr35 + 5) score += 15;
                        if (persona35 === 'talent_developer' && (f.age || 25) <= 22 && (f.potential || 60) > 70) score += 30;
                        if ((persona35 === 'big_spender' || persona35 === 'brand_first') && ((f.dynamic_state && f.dynamic_state.fame) || 0) > 200) score += 20;
                        if (persona35 === 'balanced' && fOvr > leagueAvgOvr35 + 3) score += 10;
                        if (club.staff) {
                            Object.values(club.staff).forEach(sid => {
                                const s = gs.staff && gs.staff[sid];
                                if (!s) return;
                                if (s.trait === 'Striking Specialist' && ((f.style_affinities && f.style_affinities.boxing) || 0) > 65) score += 10;
                                if (s.trait === 'Grappling Specialist' && ((f.style_affinities && f.style_affinities.naked_wrestling) || 0) > 65) score += 10;
                            });
                        }
                        const marketValue35 = Math.floor(fOvr * 1200);
                        if (listing.askingFee < marketValue35 * 0.7) score += 15;
                        if (score > bestScore35) { bestScore35 = score; bestCandidate35 = { fighter: f, askingFee: listing.askingFee }; }
                    });

                    const minScore35 = needsMoreFighters ? 20 : 40;
                    if (bestCandidate35 && bestScore35 >= minScore35) {
                        this._processNPCpoaching(bestCandidate35.fighter, club, bestCandidate35.askingFee);
                        gs.listedForTransfer = gs.listedForTransfer.filter(l => l.fighterId !== bestCandidate35.fighter.id);
                    }
                }
            }

            // 4. AI Bosman Poaching (End of Contract stealing — strategic)
            if (club.fighter_ids.length < 8 && club.money > wageBill * 1.5 && Math.random() < 0.10) {
                let bosmanTargets = [];
                const bosmanNeeds = this._getSquadStyleNeeds(club);
                const clubHighOvr = Math.max(0, ...club.fighter_ids.map(id => { let f = gs.getFighter(id); return f ? this._getFullOvr(f) : 0; }));

                Object.values(gs.fighters).forEach(f => {
                    if (f.club_id && f.club_id !== club.id && !f.retired && f.contract && f.contract.seasons_remaining === 1 && !f.contract.renewed_this_offseason) {
                        let alreadySigned = gs.pendingBosmanMoves && gs.pendingBosmanMoves.find(m => m.fighterId === f.id);
                        if (alreadySigned) return;

                        let bScore = 0;
                        let fOvr = this._getFullOvr(f);
                        if (fOvr > clubHighOvr - 5) bScore += 30;
                        if (fOvr > clubHighOvr) bScore += 20;
                        if (f.age <= 25 && (f.potential || 60) > 70) bScore += 25;

                        // Style gap bonus
                        const fAffs = f.style_affinities || {};
                        ['boxing', 'naked_wrestling', 'catfight', 'sexfight'].forEach(style => {
                            if ((fAffs[style] || 0) >= 65 && bosmanNeeds[style] === 'high') bScore += 15;
                        });

                        if (bScore >= 20) bosmanTargets.push({ fighter: f, score: bScore, ovr: fOvr });
                    }
                });
                if (bosmanTargets.length > 0) {
                    bosmanTargets.sort((a, b) => b.score - a.score);
                    let target = bosmanTargets[0].fighter;
                    let tOvr = this._getFullOvr(target);
                    let offer = Math.floor(tOvr * 220 + 20000);
                    if (offer < club.money * 0.3) {
                        if (!gs.pendingBosmanMoves) gs.pendingBosmanMoves = [];
                        gs.pendingBosmanMoves.push({
                            fighterId: target.id,
                            fromClubId: target.club_id,
                            salary: offer,
                            agreementWeek: gs.week,
                            agreementSeason: gs.season,
                            toClubId: club.id
                        });
                        let oldClub = gs.getClub(target.club_id);
                        gs.addNews("transfer", `💣 BOMBSHELL: ${club.name} pre-signed ${target.name} from ${oldClub ? oldClub.name : 'another club'} on a Bosman transfer for next season!`);
                        if (target.club_id === gs.playerClubId) {
                            if (window.UIComponents && window.UIComponents.showModal) {
                                window.UIComponents.showModal("Fighter Poached!", `${club.name} agreed to terms with ${target.name} because she was in her final contract year. She leaves at the end of the season.`, "danger");
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * Tries to find an AI club to hijack a transfer when player negotiations fail.
     * Evaluates all NPC clubs for budget, roster spots, and interest.
     * Returns true if a club signed her, false otherwise.
     */
    attemptAIHijack(fighter, rejectedSalary, isBosman = false) {
        if (!fighter) return false;
        const gs = window.GameState;

        const cs = fighter.core_stats;
        const ovr = (cs.power + cs.technique + cs.speed) / 3;

        // Find interested AI clubs that can afford her and have roster space
        let validClubs = Object.values(gs.clubs).filter(club => {
            if (club.id === gs.playerClubId) return false;
            if (club.fighter_ids.length >= 8) return false;

            // Check budget: they need buffer, plus enough for the first year salary 
            const requiredBudget = rejectedSalary + 10000;
            if ((club.money || 0) < requiredBudget) return false;

            // Optional: Interest based on club's current average OVR vs this fighter's OVR
            const isHighPotential = (fighter.potential > 70) || (ovr > 65);
            const highestOvr = Math.max(0, ...club.fighter_ids.map(id => {
                let f = gs.getFighter(id);
                return f ? (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3 : 0;
            }));

            if (ovr < highestOvr - 15 && !isHighPotential) return Math.random() < 0.2;

            return Math.random() < 0.6; // 60% chance to bid if they have money and space
        });

        if (validClubs.length === 0) return false;

        validClubs.sort((a, b) => b.money - a.money);
        let winningClub = validClubs[0];

        if (isBosman) {
            if (!gs.pendingBosmanMoves) gs.pendingBosmanMoves = [];
            gs.pendingBosmanMoves.push({
                fighterId: fighter.id,
                fromClubId: fighter.club_id,
                salary: rejectedSalary,
                agreementWeek: gs.week,
                agreementSeason: gs.season,
                toClubId: winningClub.id
            });
            gs.addNews("transfer", `${winningClub.name} hijacked the Bosman deal for ${fighter.name} right under your nose!`);
        } else {
            // Remove from old club or transfer pool if signing immediately
            if (fighter.club_id && fighter.club_id !== winningClub.id) {
                let oldClub = gs.getClub(fighter.club_id);
                if (oldClub) {
                    oldClub.fighter_ids = oldClub.fighter_ids.filter(id => id !== fighter.id);
                }
            } else {
                let idx = gs.transferPool.findIndex(f => f.id === fighter.id);
                if (idx !== -1) gs.transferPool.splice(idx, 1);
            }

            winningClub.money -= rejectedSalary; // Pay first year / signing bonus
            fighter.club_id = winningClub.id;
            fighter.contract = {
                salary: rejectedSalary,
                seasons_remaining: 3,
                win_bonus: Math.floor(rejectedSalary * 0.1),
                release_clause: rejectedSalary * 8,
                happiness: 80,
                demand_triggered: false
            };
            fighter.releasedByPlayerClub = false;
            if (!winningClub.fighter_ids.includes(fighter.id)) {
                winningClub.fighter_ids.push(fighter.id);
            }
            gs.fighters[fighter.id] = fighter;

            gs.addNews("transfer", `${winningClub.name} swooped in and signed ${fighter.name} after negotiations broke down!`);
        }

        return true;
    },

    /**
     * For each fighter listed by the player, generate bids from interested AI clubs
     * and push them to gs.transferInbox for the player to review (FM-style).
     */
    _generateInboxBids() {
        const gs = window.GameState;
        if (!gs.listedForTransfer || gs.listedForTransfer.length === 0) return;

        gs.listedForTransfer.forEach(listing => {
            // ONLY generate inbox bids if the player listed the fighter.
            // AI-to-AI listed fighters shouldn't create bids in the player's inbox.
            if (listing.listedBy !== gs.playerClubId) return;

            const fighter = gs.getFighter(listing.fighterId);
            if (!fighter) return;

            const cs = fighter.core_stats;
            const ovr = (cs.power + cs.technique + cs.speed) / 3;

            Object.values(gs.clubs).forEach(club => {
                if (club.id === gs.playerClubId) return;
                if (club.fighter_ids.length >= 8) return;
                if ((club.money || 0) < listing.askingFee * 0.5) return;

                // Interest probability scales with OVR
                const interestChance = 0.25 + (ovr / 250);
                if (Math.random() > interestChance) return;

                // Avoid duplicate bids from same club for same fighter this week
                const alreadyBid = gs.transferInbox.find(b => b.fighterId === fighter.id && b.biddingClubId === club.id);
                if (alreadyBid) return;

                // Bid between 75%–120% of asking fee
                const bidVariance = 0.75 + Math.random() * 0.45;
                const bidAmount = Math.floor(listing.askingFee * bidVariance);

                gs.transferInbox.push({
                    id: `bid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    fighterId: fighter.id,
                    biddingClubId: club.id,
                    offerAmount: bidAmount,
                    weekReceived: gs.week,
                    askingFee: listing.askingFee
                });
            });
        });
    },

    /**
     * Compute a fighter's willingness to leave (FM-style morale/contract/relationships).
     * Returns { level: 'wants_out'|'restless'|'neutral'|'settled', score: 0-100, reasons: [] }
     */
    _computeFighterWillingness(fighter) {
        if (!fighter) return { level: 'neutral', score: 50, reasons: [] };
        const gs = window.GameState;
        let score = 50;
        const reasons = [];

        const morale = fighter.dynamic_state?.morale ?? 70;
        if (morale < 30) { score += 30; reasons.push('Critically low morale'); }
        else if (morale < 50) { score += 15; reasons.push('Low morale'); }
        else if (morale > 75) { score -= 20; reasons.push('Happy & motivated'); }

        const happiness = fighter.contract?.happiness ?? 50;
        if (happiness < 40) { score += 20; reasons.push('Unhappy with contract'); }
        else if (happiness > 70) { score -= 15; reasons.push('Content with contract'); }

        const seasons = fighter.contract?.seasons_remaining ?? 2;
        if (seasons <= 1) { score += 25; reasons.push('Final contract year'); }

        const stress = fighter.dynamic_state?.stress ?? 0;
        if (stress > 70) { score += 10; reasons.push('Extremely stressed'); }

        // Lovers in same club = strong anchor (works for both player and NPC clubs)
        const club = gs.getClub(fighter.club_id || gs.playerClubId);
        if (club) {
            club.fighter_ids.forEach(id => {
                if (id === fighter.id) return;
                if (window.RelationshipEngine) {
                    const rel = window.RelationshipEngine.getRelationship(fighter.id, id);
                    if (rel && (rel.type === 'lovers' || rel.type === 'obsession' || rel.type === 'committed')) {
                        const partnerName = gs.getFighter(id)?.name || '?';
                        score -= 30;
                        reasons.push(`Has lover ${partnerName} here`);
                    }
                }
            });
        }

        score = Math.max(0, Math.min(100, score));
        let level = score >= 75 ? 'wants_out' : score >= 55 ? 'restless' : score >= 35 ? 'neutral' : 'settled';
        return { level, score, reasons };
    },

    /**
     * Weekly: fighters with very high willingness may formally demand a transfer.
     */
    _processTransferDemands() {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (!club) return;

        club.fighter_ids.forEach(fId => {
            const f = gs.getFighter(fId);
            if (!f || !f.contract || f.contract.demand_triggered) return;
            const w = this._computeFighterWillingness(f);
            if (w.level === 'wants_out' && Math.random() < 0.15) {
                f.contract.demand_triggered = true;
                if (!gs.pendingTransferDemands) gs.pendingTransferDemands = [];
                if (!gs.pendingTransferDemands.find(d => d.fighterId === fId)) {
                    gs.pendingTransferDemands.push({ fighterId: fId, week: gs.week, willingness: w });
                    gs.addNews('transfer', `⚠️ ${f.name} has formally requested a transfer!`);
                }
            }
        });
    },

    _generateProspects() {
        const gs = window.GameState;
        let pId = Date.now();
        let totalGen = 0;

        // 1. Academy Prospects (16-19 yrs old, low base, high ceiling)
        let numAca = Math.floor(Math.random() * 4) + 3; // 3-6
        for (let i = 0; i < numAca; i++) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1; // Global pool up to 490
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_a${i}`, fName, 16 + Math.floor(Math.random() * 4));
            f.avatar = avatarPath;
            f.core_stats = {
                power: 35 + Math.random() * 25, technique: 35 + Math.random() * 25,
                control: 35 + Math.random() * 25, speed: 45 + Math.random() * 25,
                endurance: 40 + Math.random() * 25, resilience: 35 + Math.random() * 25,
                aggression: 40 + Math.random() * 30, composure: 30 + Math.random() * 30,
                presence: 30 + Math.random() * 30
            };
            // Round them
            for (let k in f.core_stats) f.core_stats[k] = Math.max(10, Math.floor(f.core_stats[k]));

            f.traits = ['academy_product'];
            gs.transferPool.push(f);
            totalGen++;
        }

        // 2. Free Agents (24-30 yrs old)
        let numFA = Math.floor(Math.random() * 4) + 2; // 2-5
        for (let i = 0; i < numFA; i++) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1;
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_f${i}`, fName, 24 + Math.floor(Math.random() * 7));
            f.avatar = avatarPath;

            // Random tier: 35% elite, 45% avg, 20% washed
            let r = Math.random();
            let base = r < 0.35 ? 78 : (r < 0.8 ? 65 : 45);
            let variance = r < 0.35 ? 15 : (r < 0.8 ? 15 : 20);

            f.core_stats = {
                power: base + Math.random() * variance, technique: base + Math.random() * variance,
                control: base + Math.random() * variance, speed: base - 5 + Math.random() * variance,
                endurance: base - 5 + Math.random() * variance, resilience: base + 5 + Math.random() * variance,
                aggression: base + 5 + Math.random() * variance, composure: base + 15 + Math.random() * 10,
                presence: base + Math.random() * variance
            };
            for (let k in f.core_stats) f.core_stats[k] = Math.min(100, Math.max(10, Math.floor(f.core_stats[k])));

            f.personality.archetype = "Strategist";
            gs.transferPool.push(f);
            totalGen++;
        }

        // 2.5. Elite Prodigies (18-21 yrs old, instantly viable)
        let numProdigy = Math.floor(Math.random() * 2) + 1; // 1-2
        for (let i = 0; i < numProdigy; i++) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1;
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_p${i}`, fName, 18 + Math.floor(Math.random() * 4));
            f.avatar = avatarPath;

            f.core_stats = {
                power: 75 + Math.random() * 15, technique: 75 + Math.random() * 15,
                control: 70 + Math.random() * 15, speed: 75 + Math.random() * 15,
                endurance: 75 + Math.random() * 15, resilience: 70 + Math.random() * 15,
                aggression: 75 + Math.random() * 15, composure: 65 + Math.random() * 15,
                presence: 80 + Math.random() * 15
            };
            for (let k in f.core_stats) f.core_stats[k] = Math.min(100, Math.max(10, Math.floor(f.core_stats[k])));

            f.personality.archetype = ["Alpha", "Showboat", "Strategist"][Math.floor(Math.random() * 3)];
            f.traits = ['wonderkid'];
            gs.transferPool.push(f);
            totalGen++;
        }

        // 3. International Imports (20-25 yrs old)
        let numInt = Math.floor(Math.random() * 3) + 1; // 1-3
        for (let i = 0; i < numInt; i++) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1;
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_i${i}`, fName, 20 + Math.floor(Math.random() * 6));
            f.avatar = avatarPath;

            let type = Math.random() < 0.5 ? 'physical' : 'technical';
            if (type === 'physical') {
                f.core_stats = {
                    power: 75 + Math.random() * 20, technique: 50 + Math.random() * 20,
                    control: 50 + Math.random() * 20, speed: 75 + Math.random() * 20,
                    endurance: 75 + Math.random() * 20, resilience: 75 + Math.random() * 20,
                    aggression: 70 + Math.random() * 20, composure: 50 + Math.random() * 20,
                    presence: 60 + Math.random() * 20
                };
            } else {
                f.core_stats = {
                    power: 50 + Math.random() * 20, technique: 75 + Math.random() * 20,
                    control: 75 + Math.random() * 20, speed: 60 + Math.random() * 20,
                    endurance: 60 + Math.random() * 20, resilience: 50 + Math.random() * 20,
                    aggression: 50 + Math.random() * 20, composure: 75 + Math.random() * 20,
                    presence: 60 + Math.random() * 20
                };
            }
            for (let k in f.core_stats) f.core_stats[k] = Math.min(100, Math.max(10, Math.floor(f.core_stats[k])));

            gs.transferPool.push(f);
            totalGen++;
        }

        // 4. Viral Star (0-1)
        if (Math.random() < 0.7) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1;
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_v`, fName, 18 + Math.floor(Math.random() * 5));
            f.avatar = avatarPath;
            f.core_stats = {
                power: 45 + Math.random() * 20, technique: 40 + Math.random() * 20,
                control: 40 + Math.random() * 20, speed: 50 + Math.random() * 20,
                endurance: 45 + Math.random() * 20, resilience: 40 + Math.random() * 20,
                aggression: 55 + Math.random() * 20, composure: 35 + Math.random() * 20,
                presence: 85 + Math.random() * 15
            };
            for (let k in f.core_stats) f.core_stats[k] = Math.min(100, Math.max(10, Math.floor(f.core_stats[k])));

            f.personality.archetype = "Showboat";
            f.dynamic_state.stress = 40; // Starts stressed from fame
            gs.transferPool.push(f);
            totalGen++;
        }

        // 5. Redemption Arc (0-1)
        if (Math.random() < 0.5) {
            let fName = window.GameNames.generateName();
            let picId = Math.floor(Math.random() * 490) + 1;
            let avatarPath = `generic/${picId}.png`;

            let f = this._buildFighterBase(`prospect_${pId}_r`, fName, 23 + Math.floor(Math.random() * 7));
            f.avatar = avatarPath;
            f.core_stats = {
                power: 55 + Math.random() * 20, technique: 75 + Math.random() * 20,
                control: 65 + Math.random() * 20, speed: 45 + Math.random() * 20,
                endurance: 40 + Math.random() * 20, resilience: 40 + Math.random() * 20,
                aggression: 50 + Math.random() * 20, composure: 55 + Math.random() * 20,
                presence: 60 + Math.random() * 20
            };
            for (let k in f.core_stats) f.core_stats[k] = Math.min(100, Math.max(10, Math.floor(f.core_stats[k])));

            f.personality.archetype = "Underdog";
            f.dynamic_state.morale = 20; // Needs redemption
            gs.transferPool.push(f);
            totalGen++;
        }

        console.log(`Generated ${totalGen} mixed free agents for the season.`);
    },

    _generateStaff() {
        const gs = window.GameState;
        const roles = ['head_coach', 'striking_coach', 'grapple_coach', 'conditioning_coach', 'psych_coach'];
        const numNew = Math.floor(Math.random() * 2) + 1; // 1 to 2 new staff per year

        for (let i = 0; i < numNew; i++) {
            let role = roles[Math.floor(Math.random() * roles.length)];
            let id = `staff_gen_${Date.now()}_${i}`;
            let skill = 65 + Math.floor(Math.random() * 20); // 65 to 84 skill

            let s = {
                id: id,
                name: "Coach " + ["Smith", "Watanabe", "Silva", "Johnson", "Ivanov"][Math.floor(Math.random() * 5)],
                role: role,
                skill: skill,
                trait: ["Motivator", "Disciplinarian", "Analyst", "Rehabilitationist"][Math.floor(Math.random() * 4)],
                synergies: [], conflicts: [],
                passive_bonus: {},
                salary: 4000 + (skill * 25) // Halved to make affordable (was 8000 + skill*50)
            };

            // Dynamic skill-based bonuses. Skill is usually 65-84.
            // A skill 65 coach gives ~base bonus, a skill 84 coach gives significantly more.
            let skillMod = (skill - 65) / 20; // 0.0 to ~1.0

            if (role === 'head_coach') {
                s.passive_bonus = { all_training_gain: 2 + (skillMod * 3), match_composure: 1 + (skillMod * 3) };
            }
            if (role === 'striking_coach') {
                s.passive_bonus = { boxing_affinity_growth: 3 + (skillMod * 5), technique_in_boxing: 1 + (skillMod * 3) };
            }
            if (role === 'grapple_coach') {
                s.passive_bonus = { naked_wrestling_affinity_growth: 3 + (skillMod * 5), control_in_grapple: 1 + (skillMod * 3) };
            }
            if (role === 'conditioning_coach') {
                s.passive_bonus = { endurance_growth: 2 + (skillMod * 4), fatigue_drain_reduction: 5 + (skillMod * 15) };
            }
            if (role === 'psych_coach') {
                s.passive_bonus = { composure_growth: 2 + (skillMod * 4), stress_drain_reduction: 5 + (skillMod * 15) };
            }

            gs.staff[id] = s;
            gs.staffPool.push(id);
        }
        console.log(`Generated ${numNew} new staff members.`);
    },

    _buildFighterBase(id, name, age) {
        const motivatorPool = ['Winning', 'Respect', 'Money', 'Dominance', 'Fame', 'Revenge', 'Loyalty'];
        const shuffled = motivatorPool.sort(() => 0.5 - Math.random());
        const motivators = shuffled.slice(0, 2 + Math.floor(Math.random() * 2));
        const rivalryStyles = ['Aggressive', 'Psychological', 'Technical', 'Intimidation', 'Playful'];
        const archetypes = ['Rebel', 'Strategist', 'Brawler', 'Underdog', 'Showboat', 'Tactician'];
        const selectedArchetype = archetypes[Math.floor(Math.random() * archetypes.length)];

        // Realistic variations in fighting styles
        let generatedAffinities = { naked_wrestling: 10, boxing: 10, catfight: 10, sexfight: 10 };
        const styleBackgrounds = ['Striker', 'Grappler', 'Brawler', 'Erotic', 'Balanced'];
        const bg = styleBackgrounds[Math.floor(Math.random() * styleBackgrounds.length)];

        const r = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

        if (bg === 'Striker') {
            generatedAffinities.boxing = r(65, 85);
            generatedAffinities.naked_wrestling = r(10, 30);
            generatedAffinities.catfight = r(30, 50);
            generatedAffinities.sexfight = r(5, 25);
        } else if (bg === 'Grappler') {
            generatedAffinities.naked_wrestling = r(65, 85);
            generatedAffinities.boxing = r(10, 30);
            generatedAffinities.catfight = r(30, 50);
            generatedAffinities.sexfight = r(20, 40);
        } else if (bg === 'Brawler') {
            generatedAffinities.catfight = r(70, 90);
            generatedAffinities.boxing = r(40, 60);
            generatedAffinities.naked_wrestling = r(30, 50);
            generatedAffinities.sexfight = r(15, 35);
        } else if (bg === 'Erotic') {
            generatedAffinities.sexfight = r(75, 95);
            generatedAffinities.naked_wrestling = r(40, 60);
            generatedAffinities.catfight = r(30, 50);
            generatedAffinities.boxing = r(5, 20);
        } else {
            // Balanced
            generatedAffinities.naked_wrestling = r(40, 55);
            generatedAffinities.boxing = r(40, 55);
            generatedAffinities.catfight = r(40, 55);
            generatedAffinities.sexfight = r(40, 55);
        }

        return {
            id: id,
            name: name,
            age: age,
            core_stats: { power: 50, technique: 50, control: 50, speed: 50, endurance: 50, resilience: 50, aggression: 50, composure: 50, presence: 50 },
            style_affinities: generatedAffinities,
            personality: {
                archetype: selectedArchetype,
                dominance_hunger: 30 + Math.floor(Math.random() * 40),
                submissive_lean: 20 + Math.floor(Math.random() * 40),
                motivators: motivators,
                rivalry_style: rivalryStyles[Math.floor(Math.random() * rivalryStyles.length)],
                boundaries: []
            },
            dynamic_state: {
                form: 50,
                stress: 0,
                fatigue: 0,
                injury: "none",
                morale: 70,
                wins: 0,
                losses: 0,
                win_streak: 0,
                injuries: [],
                relationships: {},
                scarred_weeks: 0,
                ego: 'Normal',
                fame: 0
            },
            record: { w: 0, l: 0 },
            training_focus: 'general',
            potential: window.GameState._generatePotential(age, selectedArchetype || 'Alpha'),
            get natural_ceiling() { return this.potential; },
            tier: 1,
            traits: [],
            contract: null,
            scouted: false
        };
    },

    /**
     * Executes an immediate NPC-to-NPC transfer buyout
     */
    _processNPCpoaching(targetFighter, buyerClub, buyoutCost) {
        const gs = window.GameState;
        let oldClub = gs.getClub(targetFighter.club_id);

        if (oldClub) {
            oldClub.money += buyoutCost;
            oldClub.fighter_ids = oldClub.fighter_ids.filter(id => id !== targetFighter.id);
        }

        buyerClub.money -= buyoutCost;
        let salaryIncrease = Math.floor(targetFighter.contract.salary * 1.5); // Standard 50% raise when poached
        if (salaryIncrease < 40000) salaryIncrease = 40000;

        targetFighter.club_id = buyerClub.id;
        targetFighter.contract = {
            salary: salaryIncrease,
            seasons_remaining: 3,
            win_bonus: Math.floor(salaryIncrease * 0.1),
            release_clause: salaryIncrease * 10,
            happiness: 100,
            demand_triggered: false
        };

        buyerClub.fighter_ids.push(targetFighter.id);
        gs.addNews("transfer", `🚨 MEGA DEAL: ${buyerClub.name} triggered the $${buyoutCost.toLocaleString()} release clause to poach ${targetFighter.name} from ${oldClub ? oldClub.name : 'their rivals'}!`);
    }
};