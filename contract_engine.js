/**
 * contract_engine.js
 * Handles the logic for dynamic fatigue, contract negotiations, renewals, and financial crisis events.
 */

window.ContractEngine = {
    /**
     * Re-calculates contract happiness for every fighter in the game
     */
    updateAllContracts() {
        const gs = window.GameState;

        // Loop through all clubs
        Object.values(gs.clubs).forEach(club => {
            if (club.fighter_ids) {
                club.fighter_ids.forEach(id => {
                    let f = gs.getFighter(id);
                    if (f && f.contract) {
                        this.calculateHappiness(f);
                    }
                });
            }
        });

        // Loop through unsigned free agents
        gs.transferPool.forEach(id => {
            let f = gs.getFighter(id);
            if (f && f.contract) {
                this.calculateHappiness(f); // Keep them ticking
            }
        });
    },

    getPerceivedWorth(fighter) {
        // 1. Calculate True OVR across all 9 core stats for accurate scaling
        const cs = fighter.core_stats;
        const totalStats = cs.power + cs.technique + cs.speed + cs.control + cs.endurance + cs.resilience + cs.aggression + cs.composure + cs.presence;
        const trueOvr = totalStats / 9;

        // 2. Base Market Curve (Flattened to stop extreme 90+ OVR salaries)
        // Previous formula `(trueOvr - 50) * 350` ballooned top-tiers to 300k+. 
        let baseValue = 5000;
        if (trueOvr > 50) {
            let pointsAbove50 = trueOvr - 50;
            // First 20 points (50 to 70 OVR): $200 per point
            let tier1 = Math.min(20, pointsAbove50) * 200;
            // Next 10 points (70 to 80 OVR): $400 per point
            let tier2 = Math.max(0, Math.min(10, pointsAbove50 - 20)) * 400;
            // Final points (80+ OVR): $800 per point
            let tier3 = Math.max(0, pointsAbove50 - 30) * 800;

            baseValue += tier1 + tier2 + tier3;
        }

        // 3. Age & Potential Modifiers
        if (fighter.age <= 22) baseValue *= 1.15; // Prospect premium
        if (fighter.age >= 34) baseValue *= 0.85; // Veteran discount

        // 4. Fame and Form Modifiers
        let fameScore = fighter.dynamic_state.fame || (trueOvr * 15);
        let winStreak = Math.max(0, fighter.dynamic_state.wins - fighter.dynamic_state.losses);
        baseValue += (fameScore * 0.5);
        baseValue += (winStreak * 400);

        // 5. Personality & Traits
        if (fighter.personality?.archetype === 'Showboat') baseValue += 4000;
        if (fighter.traits?.includes('academy_product') && fighter.club_id === window.GameState.playerClubId) baseValue -= 2000;

        // 6. Hard Floor based on Current Salary (Crucial fix for contract extensions)
        // If a fighter is currently making $26k, she won't randomly ask for $10k just because her base OVR dropped slightly.
        if (fighter.contract && fighter.contract.salary > 0) {
            let salaryFloor = fighter.contract.salary;
            // Only drop the floor if she is aging out and clearly underperforming
            if (fighter.age >= 34 && trueOvr < 80) {
                salaryFloor *= 0.85;
            }
            baseValue = Math.max(baseValue, salaryFloor);
        }

        return Math.floor(baseValue);
    },

    calculateHappiness(fighter) {
        if (!fighter.contract) return;

        let perceived_worth = this.getPerceivedWorth(fighter);
        // Protect against 0 perceived worth causing division errors
        let happiness_delta = (fighter.contract.salary / (perceived_worth || 1)) - 1.0;

        let curHappy = fighter.contract.happiness || 75;

        if (happiness_delta >= 0.1) {
            curHappy += 2; // Happy
        } else if (happiness_delta < -0.1 && happiness_delta >= -0.25) {
            curHappy -= 3; // Underpaid
        } else if (happiness_delta < -0.25) {
            curHappy -= 7; // Substantially underpaid
        } else {
            // Neutral drift towards 60
            if (curHappy > 60) curHappy -= 1;
            if (curHappy < 60) curHappy += 1;
        }

        fighter.contract.happiness = Math.max(0, Math.min(100, curHappy));

        // Morale tethering
        fighter.dynamic_state.morale = fighter.contract.happiness;
    },

    checkContractDemands(fighter) {
        if (!fighter.contract) return null;
        if (fighter.contract.demand_triggered) return null;

        let threshold = 50;
        let arch = fighter.personality?.archetype;

        if (arch === 'Showboat') threshold = 65;
        if (arch === 'Alpha') threshold = 55;
        if (arch === 'Rebel' || arch === 'Ice Queen') threshold = 50;
        if (arch === 'Technician' || arch === 'Strategist') threshold = 45;
        if (arch === 'Veteran') threshold = 40;
        if (arch === 'Underdog') threshold = 35;

        // Special brutal underdog logic - walks immediately
        if (arch === 'Underdog' && fighter.contract.happiness < 35) {
            return {
                type: 'walk',
                text: `${fighter.name} felt completely exploited despite her loyalty. She has left the club immediately and entered free agency.`
            };
        }

        if (fighter.contract.happiness < threshold) {
            fighter.contract.demand_triggered = true;
            let demanded_salary = this.getPerceivedWorth(fighter);

            return {
                type: 'demand',
                requested_salary: demanded_salary,
                text: `${fighter.name} is furious with her current wage of $${fighter.contract.salary.toLocaleString()}/yr and is demanding an immediate raise to $${demanded_salary.toLocaleString()}/yr.`
            };

        }

        return null;
    },

    processRenewalOffers() {
        const gs = window.GameState;
        let playerClub = gs.getClub(gs.playerClubId);
        let offers = [];

        playerClub.fighter_ids.forEach(id => {
            let f = gs.getFighter(id);
            if (f && f.contract && f.contract.seasons_remaining === 1) {
                let ovr = Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                let new_salary = (ovr * 145) + (f.dynamic_state.wins * 350) + 9000;
                offers.push({
                    fighter: f,
                    requested_salary: new_salary
                });
            }
        });

        return offers;
    },

    offerNewContract(fighterId, salary, seasons, isPlayerAction = true) {
        const gs = window.GameState;
        const f = gs.getFighter(fighterId);
        if (!f) return { accepted: false, message: "Fighter not found." };

        // AI simply auto-signs
        if (!isPlayerAction) {
            f.contract.salary = salary;
            f.contract.seasons_remaining = seasons;
            f.contract.release_clause = salary * 10; // Default significantly higher to protect AI rosters
            f.contract.win_bonus = Math.round(salary * 0.1);
            f.contract.happiness = 100;
            f.contract.demand_triggered = false;
            f.transfer_listed = false;
            if (gs.pendingTransferDemands) {
                gs.pendingTransferDemands = gs.pendingTransferDemands.filter(d => d.fighterId !== fighterId);
            }
            return { accepted: true, message: "Accepted." };
        }

        let base_req = this.getPerceivedWorth(f);
        let modifier = 1.0;
        let reasons = [];

        // 1. Happiness Modifiers
        let curHappy = f.contract.happiness || 50;
        if (curHappy > 80) {
            modifier *= 0.90; // 10% discount
            reasons.push("She is very happy at the club and willing to take less.");
        } else if (curHappy < 40 && curHappy >= 20) {
            modifier *= 1.20; // 20% premium
            reasons.push("She is unhappy and demands a premium to stay.");
        } else if (curHappy < 20) {
            modifier *= 1.50; // 50% premium
            reasons.push("She is miserable here and wants a massive overpay to consider staying.");
        }

        // 2. Personality Modifiers
        let arch = f.personality?.archetype || 'Neutral';
        let mots = f.personality?.motivators || [];
        if (mots.includes('Money') || arch === 'Showboat') {
            modifier *= 1.15;
            reasons.push("She is driven by money and expects a lucrative deal.");
        }
        if (mots.includes('Loyalty') || arch === 'Underdog') {
            modifier *= 0.85;
            reasons.push("Her loyalty and underdog nature makes her easier to negotiate with.");
        }

        // 3. Relationship Modifiers
        let hasLover = false;
        let hasRival = false;
        if (window.RelationshipEngine) {
            const club = gs.getClub(gs.playerClubId);
            if (club && club.fighter_ids) {
                club.fighter_ids.forEach(id => {
                    if (id !== f.id) {
                        let rel = window.RelationshipEngine.getRelationship(f.id, id);
                        if (rel && rel.type !== 'neutral') {
                            let relType = rel.type;
                            if (relType === 'lovers' || relType === 'best_friends' || relType === 'committed' || relType === 'obsession') hasLover = true;
                            if (relType === 'bitter_rivals' || relType === 'rivalry') hasRival = true;
                        }
                    }
                });
            }
        }

        if (hasLover) {
            modifier *= 0.85;
            reasons.push("Having close bonds at the club makes her want to stay.");
        }
        if (hasRival) {
            modifier *= 1.15;
            reasons.push("Club drama with rivals makes her hesitant to commit without a premium.");
        }

        let final_req = Math.floor(base_req * modifier);
        let acceptRatio = salary / final_req;

        // Massive unhappiness outright refusal chance
        if (curHappy < 20 && acceptRatio < 1.2) {
            f.contract.happiness -= 15;
            f.dynamic_state.morale -= 15;
            return { accepted: false, message: "She is too miserable to accept anything less than an exorbitant offer. " + reasons.join(" ") };
        }

        if (acceptRatio >= 0.95) { // 5% wiggle room
            f.contract.salary = salary;
            f.contract.seasons_remaining = seasons;
            f.contract.release_clause = salary * 10;
            f.contract.win_bonus = Math.round(salary * 0.1);
            f.contract.happiness = 100;
            f.contract.demand_triggered = false;
            f.transfer_listed = false;
            if (gs.pendingTransferDemands) {
                gs.pendingTransferDemands = gs.pendingTransferDemands.filter(d => d.fighterId !== fighterId);
            }
            return { accepted: true, message: reasons.join(" ") || "She felt the offer was fair and accepted." };
        }

        f.contract.happiness -= 15;
        f.dynamic_state.morale -= 15;

        // Feedback magnitude
        let fb = "She rejected the offer.";
        if (acceptRatio < 0.5) {
            fb = "She felt the offer was deeply insulting and rejected it outright.";
        } else if (acceptRatio < 0.8) {
            fb = "She requires a significantly better offer to sign.";
        } else {
            fb = "She is close, but wants a bit more money.";
        }

        return { accepted: false, message: (fb + " " + reasons.join(" ")).trim() };
    },

    startNegotiation(fighter) {
        if (!fighter.contract) return null;

        const gs = window.GameState;
        if (gs.pendingBosmanMoves && gs.pendingBosmanMoves.find(m => m.fighterId === fighter.id)) {
            fighter.contract.negotiation = { active: false, walkReason: "She has already signed a pre-contract to join another club next season." };
            return fighter.contract.negotiation;
        }

        let base_req = this.getPerceivedWorth(fighter);
        let modifier = 1.0;
        let reasons = [];

        let curHappy = fighter.contract.happiness || 50;
        if (curHappy > 80) modifier *= 0.90;
        else if (curHappy < 40 && curHappy >= 20) modifier *= 1.20;
        else if (curHappy < 20) modifier *= 1.50;

        let arch = fighter.personality?.archetype || 'Neutral';
        let mots = fighter.personality?.motivators || [];
        if (mots.includes('Money') || arch === 'Showboat') modifier *= 1.15;
        if (mots.includes('Loyalty') || arch === 'Underdog') modifier *= 0.85;

        let hasLover = false;
        let hasRival = false;
        if (window.RelationshipEngine) {
            const gs = window.GameState;
            const club = gs.getClub(gs.playerClubId);
            if (club && club.fighter_ids) {
                club.fighter_ids.forEach(id => {
                    if (id !== fighter.id) {
                        let rel = window.RelationshipEngine.getRelationship(fighter.id, id);
                        if (rel && rel.type !== 'neutral') {
                            let relType = rel.type;
                            if (relType === 'lovers' || relType === 'best_friends' || relType === 'committed' || relType === 'obsession') hasLover = true;
                            if (relType === 'bitter_rivals' || relType === 'rivalry') hasRival = true;
                        }
                    }
                });
            }
        }

        if (hasLover) modifier *= 0.85;
        if (hasRival) modifier *= 1.15;

        let targetSalary = Math.floor(base_req * modifier);

        let targetDuration = 3;
        if (fighter.age <= 22) targetDuration = 4;
        if (fighter.age >= 34) targetDuration = 1;
        if (fighter.age >= 30 && fighter.age < 34) targetDuration = 2;
        if (mots.includes('Loyalty')) targetDuration += 1;
        if (mots.includes('Money') && fighter.age < 30) targetDuration -= 1;
        if (arch === 'Showboat') targetDuration -= 1;
        if (arch === 'Underdog') targetDuration += 1;

        targetDuration = Math.max(1, Math.min(5, targetDuration));

        let targetReleaseClause = targetSalary * 8; // Default 8x
        if (mots.includes('Loyalty')) targetReleaseClause = targetSalary * 12;
        if (mots.includes('Money') || arch === 'Showboat') targetReleaseClause = targetSalary * 5; // Wants an easier way out

        if (curHappy < 20) {
            fighter.contract.negotiation = { active: false, walkReason: "She is too miserable to even sit at the negotiating table right now." };
            return fighter.contract.negotiation;
        }

        fighter.contract.negotiation = {
            active: true,
            patience: 3,
            targetSalary: targetSalary,
            targetDuration: targetDuration,
            targetReleaseClause: targetReleaseClause,
            reasons: reasons
        };
        return fighter.contract.negotiation;
    },

    evaluateOffer(fighterId, offerSalary, offerDuration, offerReleaseClause) {
        const gs = window.GameState;
        const fighter = gs.getFighter(fighterId);
        if (!fighter || !fighter.contract || !fighter.contract.negotiation || !fighter.contract.negotiation.active)
            return { state: 'error', message: "No active negotiation." };

        let neg = fighter.contract.negotiation;
        let demandedSalary = neg.targetSalary;
        let demandedDuration = neg.targetDuration;
        let demandedClause = neg.targetReleaseClause;

        // Ensure we have a valid offer clause
        if (!offerReleaseClause) offerReleaseClause = offerSalary * 8;

        let durationDiff = Math.abs(offerDuration - demandedDuration);
        let durationPenaltyMultiplier = 1.0;

        if (fighter.age >= 31 && offerDuration > demandedDuration) {
            durationPenaltyMultiplier = 1.0 + (0.2 * durationDiff);
        } else if (fighter.age < 25 && offerDuration < demandedDuration) {
            durationPenaltyMultiplier = 1.0 + (0.15 * durationDiff);
        } else {
            durationPenaltyMultiplier = 1.0 + (0.05 * durationDiff);
        }

        // Release Clause negotiation logic
        let clauseMultiplier = 1.0;
        let clauseRatio = offerReleaseClause / demandedClause;

        // If club demands a massive release clause, fighter wants more money
        if (clauseRatio > 1.2) {
            clauseMultiplier = 1.0 + ((clauseRatio - 1.0) * 0.15); // e.g., 2.0 ratio -> 1.15x salary
        }
        // If club offers a low release clause, fighter accepts slightly less money
        else if (clauseRatio < 0.8) {
            clauseMultiplier = 1.0 - ((1.0 - clauseRatio) * 0.05); // e.g., 0.5 ratio -> 0.975x salary (small discount)
        }

        let expectedSalaryForThisDurationAndClause = Math.floor(demandedSalary * durationPenaltyMultiplier * clauseMultiplier);
        let offerRatio = offerSalary / expectedSalaryForThisDurationAndClause;

        if (offerRatio >= 0.95) {
            fighter.contract.salary = offerSalary;
            fighter.contract.seasons_remaining = offerDuration;
            fighter.contract.release_clause = offerReleaseClause;
            fighter.contract.win_bonus = Math.round(offerSalary * 0.1);
            fighter.contract.happiness = 100;
            fighter.contract.demand_triggered = false;
            fighter.contract.demand_triggered = false;
            fighter.transfer_listed = false;

            if (window.GameState.listedForTransfer) {
                window.GameState.listedForTransfer = window.GameState.listedForTransfer.filter(d => d.fighterId !== fighterId);
            }
            if (window.GameState.transferInbox) {
                window.GameState.transferInbox = window.GameState.transferInbox.filter(d => d.fighterId !== fighterId);
            }
            if (window.GameState.pendingTransferDemands) {
                window.GameState.pendingTransferDemands = window.GameState.pendingTransferDemands.filter(d => d.fighterId !== fighterId);
            }

            fighter.contract.negotiation = null;
            return { state: 'accepted', message: "She feels this is a fair deal and has signed the contract." };
        }

        if (offerRatio < 0.70) {
            neg.patience -= 2;
            if (neg.patience <= 0) {
                fighter.contract.happiness -= 15;
                fighter.dynamic_state.morale -= 15;
                fighter.contract.negotiation.active = false;
                return { state: 'walked', message: "She is deeply insulted by this lowball offer. She has walked away from the table." };
            }
            return { state: 'rejected', message: "She found that offer insulting. Her patience is wearing extremely thin. She reiterates her initial demands.", counterSalary: demandedSalary, counterDuration: demandedDuration, counterClause: demandedClause, patience: neg.patience };
        }

        if (offerRatio < 0.95) {
            neg.patience -= 1;
            if (neg.patience <= 0) {
                fighter.contract.happiness -= 10;
                fighter.contract.negotiation.active = false;
                return { state: 'walked', message: "She is tired of haggling over pennies and has ended negotiations." };
            }
            let newCounterSalary = Math.floor((expectedSalaryForThisDurationAndClause + offerSalary) / 2);
            newCounterSalary = Math.max(newCounterSalary, Math.floor(expectedSalaryForThisDurationAndClause * 0.90));

            // Adjust the demanded clause slightly towards the offer if it's reasonable
            let newCounterClause = demandedClause;
            if (clauseRatio > 1.0 && clauseRatio < 3.0) {
                newCounterClause = Math.floor((demandedClause + offerReleaseClause) / 2);
            }

            neg.targetSalary = newCounterSalary;
            neg.targetDuration = demandedDuration;
            neg.targetReleaseClause = newCounterClause;

            return { state: 'counter', message: "She thinks we are close, but requires a better compromise.", counterSalary: newCounterSalary, counterDuration: demandedDuration, counterClause: newCounterClause, patience: neg.patience };
        }
    },

    releaseWithClause(fighterId) {
        const gs = window.GameState;
        const f = gs.getFighter(fighterId);
        const playerClub = gs.getClub(gs.playerClubId);
        if (!f || !f.contract) return false;

        if (gs.money < f.contract.release_clause) {
            return false; // Cannot afford buyout
        }

        gs.money -= f.contract.release_clause;
        playerClub.fighter_ids = playerClub.fighter_ids.filter(id => id !== fighterId);
        f.club_id = null;
        f.contract.happiness = 50; // Reset as free agent
        f.contract.demand_triggered = false;

        if (!gs.transferPool.includes(fighterId)) {
            gs.transferPool.push(fighterId);
        }

        gs.addNews('club', `${playerClub.name} triggered the release clause for ${f.name} at a cost of $${f.contract.release_clause}.`);
        return true;
    },

    _deductAnnualWages() {
        const gs = window.GameState;
        Object.values(gs.clubs).forEach(club => {
            let annual_wage_bill = 0;
            club.fighter_ids.forEach(id => {
                let f = gs.getFighter(id);
                if (f && f.contract) {
                    annual_wage_bill += f.contract.salary; // already annual
                }
            });

            // Only count actually-hired coaches (non-null slot values), salary is annual
            if (club.staff) {
                Object.values(club.staff).forEach(staffId => {
                    if (staffId && gs.staff[staffId]) {
                        annual_wage_bill += gs.staff[staffId].salary; // already annual
                    }
                });
            }

            if (club.id === gs.playerClubId) {
                gs.total_annual_wage_bill = annual_wage_bill;

                // Facility upkeep: L1=free, L2=$10k/yr, L3=$30k/yr, L4=$60k/yr
                let ut = window.FacilityData ? window.FacilityData.upkeep : [0, 0, 10000, 30000, 60000, 100000, 160000, 240000, 340000, 460000, 600000];
                let upkeep = ut[Math.min(club.facilities?.gym || 1, 10)]
                    + ut[Math.min(club.facilities?.recovery || 1, 10)]
                    + ut[Math.min(club.facilities?.pr || 1, 10)]
                    + ut[Math.min(club.facilities?.youth || 1, 10)];

                gs.money -= (annual_wage_bill + upkeep);

                if (gs.money < 0) {
                    gs.financial_crisis_weeks = (gs.financial_crisis_weeks || 0) + 1;
                } else {
                    gs.financial_crisis_weeks = 0;
                }

                gs.addNews('club', `Season wage bill paid: $${(annual_wage_bill + upkeep).toLocaleString()} deducted.`);
            } else {
                // AI club simulated bank logic
                if (!club.money) club.money = 500000;
                let ut = window.FacilityData ? window.FacilityData.upkeep : [0, 0, 10000, 30000, 60000, 100000, 160000, 240000, 340000, 460000, 600000];
                let upkeep = ut[Math.min(club.facilities?.gym || 1, 10)]
                    + ut[Math.min(club.facilities?.recovery || 1, 10)]
                    + ut[Math.min(club.facilities?.pr || 1, 10)]
                    + ut[Math.min(club.facilities?.youth || 1, 10)];

                club.money -= (annual_wage_bill + upkeep);

                if (club.money < -100000) {
                    gs.addNews('finance', `📉 MASSIVE DEBT: ${club.name} is now $${Math.abs(club.money).toLocaleString()} in the red! A fire sale is imminent.`);
                }
            }
        });
    }
};
