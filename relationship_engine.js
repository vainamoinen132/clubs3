/**
 * relationship_engine.js
 * Full relationship lifecycle with exclusivity, cheating, and consequences.
 *
 * Relationship Types (in order of intensity):
 *   neutral → aware → awareness_plus → friction | attraction
 *   → rivalry | mentor | best_friends
 *   → committed (exclusive romantic, one per fighter)
 *   → obsession (committed + tension 95+)
 *   → bitter_rivals (dominant pair, no romance)
 *
 * Key Fields on fighter.dynamic_state:
 *   primary_partner_id  — ID of exclusive romantic partner (null if single)
 *   best_friend_id      — ID of best friend (null if none)
 *   cheated_by          — ID of partner who cheated (cleared after confrontation fires)
 *   cheat_target_id     — ID of the third party the cheater is pursuing
 *   cheat_slow_burn     — weeks of suppressed attraction while cheater is committed
 */

window.RelationshipEngine = {

    // ── MAIN ENTRY POINT ─────────────────────────────────────────────────────
    addTension(fighter1Id, fighter2Id, amount, eventDescription) {
        if (fighter1Id === fighter2Id) return; // Strict safety guard: No self-relationships
        const gs = window.GameState;
        let f1 = gs.getFighter(fighter1Id);
        let f2 = gs.getFighter(fighter2Id);
        if (!f1 || !f2) return;

        let rel = this.getRelationship(fighter1Id, fighter2Id);

        rel.tension = Math.min(100, rel.tension + amount);

        let logStr = `Week ${gs.week}, S${gs.currentSeason || 1}: ${eventDescription}`;
        rel.history.push(logStr);
        rel.last_interaction_week = gs.week;

        // Resolve types — respecting exclusivity
        let newType = this.resolveType(f1, f2, rel.tension);
        rel.type = newType;

        // Power Dynamics — determines who holds the psychological edge
        this._updatePowerDynamics(f1, f2, rel);

        // Apply exclusivity side-effects (sets primary_partner_id / best_friend_id)
        this._applyExclusivity(f1, f2, rel);

        // Cheating slow-burn check
        this._checkCheatingTrigger(f1, f2, rel);

        // Milestone system
        let mTarget = null;
        if (rel.tension >= 95) mTarget = 5;
        else if (rel.tension >= 75) mTarget = 4;
        else if (rel.tension >= 55) mTarget = 3;
        else if (rel.tension >= 35) mTarget = 2;
        else if (rel.tension >= 20) mTarget = 1;

        if (mTarget !== null && rel.milestone_reached < mTarget) {
            rel.milestone_reached = mTarget;

            if (f1.club_id === gs.playerClubId || f2.club_id === gs.playerClubId) {
                gs.pendingMilestones = gs.pendingMilestones || [];
                gs.pendingMilestones.push({ f1: fighter1Id, f2: fighter2Id, milestone: mTarget });
            }
        }
    },

    // ── TYPE RESOLUTION ────────────────────────────────────────────────────────
    resolveType(fighter, otherFighter, tension) {
        const arch = fighter.personality?.archetype || 'Underdog';
        const dHunger = fighter.personality?.dominance_hunger || 50;
        const sLean = fighter.personality?.submissive_lean || 50;
        const otherArch = otherFighter.personality?.archetype || 'Underdog';
        const otherDHunger = otherFighter.personality?.dominance_hunger || 50;
        const otherSLean = otherFighter.personality?.submissive_lean || 50;

        if (tension < 20) return 'neutral';
        if (tension < 35) return 'aware';

        if (tension < 55) {
            // Friction vs attraction split
            if (arch === 'Alpha' || arch === 'Rebel') return 'friction';
            if (dHunger > 70 && otherDHunger > 70) return 'friction';
            return 'attraction';
        }

        if (tension < 75) {
            // Rivalry, mentor, or best_friends
            if (dHunger > 70 && otherDHunger > 70) return 'rivalry';
            if (arch === 'Ice Queen' && otherArch === 'Alpha') return 'rivalry';
            if (arch === 'Rebel' && otherArch === 'Rebel') return 'rivalry';
            // Mentor bond: Technician/Alpha → Underdog/Showboat
            if ((arch === 'Technician' || arch === 'Alpha') &&
                (otherArch === 'Underdog' || otherArch === 'Showboat') &&
                dHunger < 70) return 'mentor';
            // Best friend: similar archetypes, neither hugely dominant
            if (arch === otherArch && dHunger < 65 && otherDHunger < 65) return 'best_friends';
            // Submissive lean → attraction deepens
            if (sLean > 55 || otherSLean > 55) return 'attraction';
            return 'rivalry';
        }

        // Tension 75+: committed or bitter rivals
        // Both highly dominant → never lovers, always bitter rivals
        if (dHunger > 75 && otherDHunger > 75) return 'bitter_rivals';
        if (arch === 'Rebel' && otherArch === 'Rebel') return 'bitter_rivals';

        // Best-friends can deepen into committed at this point
        // (handled in _applyExclusivity / _checkCheatingTrigger)

        // Exclusivity check — if already committed to SOMEONE ELSE, cap at attraction
        const existingPartner = fighter.dynamic_state?.primary_partner_id;
        if (existingPartner && existingPartner !== otherFighter.id) {
            // Already committed elsewhere — slow burn / cheat zone
            return 'attraction'; // Capped. _checkCheatingTrigger handles the rest.
        }

        // Obsession threshold
        if (tension >= 95 && dHunger > 80 && otherSLean > 60) return 'obsession';

        return 'committed';
    },

    // ── EXCLUSIVITY APPLICATION ────────────────────────────────────────────────
    // Sets primary_partner_id / best_friend_id when type transitions
    _applyExclusivity(fighter, other, rel) {
        const ds = fighter.dynamic_state;
        if (!ds) return;

        if (rel.type === 'committed' || rel.type === 'obsession') {
            // Set primary partner only if not already set to someone else
            if (!ds.primary_partner_id || ds.primary_partner_id === other.id) {
                ds.primary_partner_id = other.id;
            }
        } else if (rel.type === 'best_friends') {
            if (!ds.best_friend_id || ds.best_friend_id === other.id) {
                ds.best_friend_id = other.id;
            }
        }

        // If relationship has broken (moved away from committed), clear the partner link
        // Only clear if the type fell below committed and the partner IS the one stored
        if (rel.type !== 'committed' && rel.type !== 'obsession') {
            if (ds.primary_partner_id === other.id) {
                // Don't auto-clear here — only clear on explicit breakup / cheat resolution
            }
        }
    },

    // ── CHEATING SLOW-BURN SYSTEM ─────────────────────────────────────────────
    _checkCheatingTrigger(f1, f2, rel) {
        const gs = window.GameState;
        // Run for each direction
        this._checkOneSidedCheat(f1, f2, rel, gs);
        this._checkOneSidedCheat(f2, f1, rel, gs);
    },

    _checkOneSidedCheat(cheater, target, rel, gs) {
        const ds = cheater.dynamic_state;
        if (!ds) return;

        const existingPartnerId = ds.primary_partner_id;

        // Only trigger if: cheater has a committed partner AND attraction to someone else
        if (!existingPartnerId || existingPartnerId === target.id) return;
        if (!['attraction', 'committed'].includes(rel.type)) return;
        if (rel.tension < 55) return; // Not pulled hard enough yet

        const existingPartner = gs.getFighter(existingPartnerId);
        if (!existingPartner) return;

        // Slow-burn counter
        if (!ds.cheat_slow_burn) ds.cheat_slow_burn = 0;
        if (ds.cheat_target_id !== target.id) {
            ds.cheat_target_id = target.id;
            ds.cheat_slow_burn = 0;
        }
        ds.cheat_slow_burn++;

        // Phase 1 — subtle news hint (slow-burn week 2)
        if (ds.cheat_slow_burn === 2) {
            gs.addNews('relationships',
                `👀 Word is spreading... something is brewing between ${cheater.name} and ${target.name}, ` +
                `despite ${cheater.name}'s commitment to ${existingPartner.name}.`
            );
        }

        // Phase 2 — discovery + confrontation (slow-burn week 4+)
        if (ds.cheat_slow_burn >= 4 && !ds.cheated_by) {
            this._fireCheatDiscovery(cheater, existingPartner, target, gs);
        }
    },

    _fireCheatDiscovery(cheater, betrayed, newTarget, gs) {
        // Mark the betrayed partner
        if (!betrayed.dynamic_state) betrayed.dynamic_state = {};
        betrayed.dynamic_state.cheated_by = cheater.id;

        // Immediate emotional impact
        betrayed.dynamic_state.morale = Math.max(0, (betrayed.dynamic_state.morale || 50) - 30);
        betrayed.dynamic_state.stress = Math.min(100, (betrayed.dynamic_state.stress || 20) + 25);
        cheater.dynamic_state.stress = Math.min(100, (cheater.dynamic_state.stress || 20) + 20);

        // News
        gs.addNews('relationships',
            `💔 BETRAYAL — ${betrayed.name} has discovered that ${cheater.name} has been pursuing ` +
            `${newTarget.name} behind her back. The locker room is in shock.`
        );

        // Queue confrontation milestone
        gs.pendingMilestones = gs.pendingMilestones || [];
        gs.pendingMilestones.push({
            type: 'BETRAYAL_CONFRONTATION',
            betrayedId: betrayed.id,
            cheaterId: cheater.id,
            newPartnerId: newTarget.id
        });
    },

    // ── CONFRONTATION RESOLUTION ──────────────────────────────────────────────
    // Called when the player resolves a BETRAYAL_CONFRONTATION event.
    // mode: 'fight' | 'part_ways'
    resolveConfrontation(betrayedId, cheaterId, newPartnerId, mode) {
        const gs = window.GameState;
        const betrayed = gs.getFighter(betrayedId);
        const cheater = gs.getFighter(cheaterId);
        const newPartner = gs.getFighter(newPartnerId);
        if (!betrayed || !cheater) return;

        // Clear cheat state
        if (betrayed.dynamic_state) betrayed.dynamic_state.cheated_by = null;
        if (cheater.dynamic_state) {
            cheater.dynamic_state.cheat_slow_burn = 0;
            cheater.dynamic_state.cheat_target_id = null;
        }

        if (mode === 'fight') {
            // Sim match is run by the UI layer. Here we just set up the relationship aftermath.
            // Win/loss is resolved in the post-confrontation-match callback.
            gs.addNews('relationships',
                `⚔️ CONFRONTATION — ${betrayed.name} has demanded satisfaction from ${cheater.name}. ` +
                `A match has been arranged behind closed doors.`
            );
        } else {
            // They split without fighting — each goes their own way
            this._breakUpCouple(cheater, betrayed);
            if (newPartner) this._formCouple(cheater, newPartner);

            betrayed.dynamic_state.morale = Math.max(0, (betrayed.dynamic_state.morale || 50) - 15);
            gs.addNews('relationships',
                `💔 ${betrayed.name} and ${cheater.name} have ended their relationship. ` +
                (newPartner ? `${cheater.name} and ${newPartner.name} are now together.` : '')
            );
        }
    },

    // Called AFTER the confrontation match concludes.
    // winner: fighter object who won the match
    resolveConfrontationMatch(betrayedId, cheaterId, newPartnerId, winnerId) {
        const gs = window.GameState;
        const betrayed = gs.getFighter(betrayedId);
        const cheater = gs.getFighter(cheaterId);
        const newPartner = newPartnerId ? gs.getFighter(newPartnerId) : null;

        if (!betrayed || !cheater) return;

        if (winnerId === betrayedId) {
            // Betrayed fighter wins — cheater is humiliated, comes back
            this._breakUpCheatRelationship(cheater, newPartner);
            this._formCouple(cheater, betrayed); // Reconcile

            cheater.dynamic_state.morale = Math.max(0, (cheater.dynamic_state.morale || 50) - 30);
            betrayed.dynamic_state.morale = Math.min(100, (betrayed.dynamic_state.morale || 50) + 20);

            // Set bitter_rivals between cheater and new target
            if (newPartner) {
                const rc = this._getOrInitRelation(cheater, newPartner.id);
                const rn = this._getOrInitRelation(newPartner, cheater.id);
                rc.type = 'bitter_rivals'; rn.type = 'bitter_rivals';
            }

            gs.addNews('relationships',
                `🏆 ${betrayed.name} defeated ${cheater.name} in their confrontation. ` +
                `${cheater.name} has returned, humiliated and apologetic.`
            );
        } else {
            // Cheater wins — breaks free, stays with new partner
            this._breakUpCouple(cheater, betrayed);
            if (newPartner) this._formCouple(cheater, newPartner);

            const rBetrayedCheater = this._getOrInitRelation(betrayed, cheater.id);
            rBetrayedCheater.type = 'bitter_rivals';
            const rCheaterBetrayed = this._getOrInitRelation(cheater, betrayed.id);
            rCheaterBetrayed.type = 'bitter_rivals';

            betrayed.dynamic_state.morale = Math.max(0, (betrayed.dynamic_state.morale || 50) - 25);
            betrayed.dynamic_state.stress = Math.min(100, (betrayed.dynamic_state.stress || 20) + 20);

            gs.addNews('relationships',
                `💔 ${cheater.name} defeated ${betrayed.name} in their confrontation and has left for ${newPartner?.name || 'someone new'}. ` +
                `${betrayed.name} is left devastated.`
            );
        }
    },

    // ── COUPLE / BREAKUP HELPERS ──────────────────────────────────────────────
    _formCouple(f1, f2) {
        if (!f1.dynamic_state) f1.dynamic_state = {};
        if (!f2.dynamic_state) f2.dynamic_state = {};
        f1.dynamic_state.primary_partner_id = f2.id;
        f2.dynamic_state.primary_partner_id = f1.id;

        const rel = this.getRelationship(f1.id, f2.id);
        rel.type = 'committed';
        rel.tension = Math.max(rel.tension, 76);
        this._updatePowerDynamics(f1, f2, rel);
    },

    _breakUpCouple(f1, f2) {
        if (!f2) return;
        if (f1.dynamic_state?.primary_partner_id === f2.id) f1.dynamic_state.primary_partner_id = null;
        if (f2.dynamic_state?.primary_partner_id === f1.id) f2.dynamic_state.primary_partner_id = null;
    },

    _breakUpCheatRelationship(cheater, newTarget) {
        if (!newTarget) return;
        this._breakUpCouple(cheater, newTarget);
        const rel = this.getRelationship(cheater.id, newTarget.id);
        rel.type = 'friction';
    },

    // ── BEST FRIEND SYSTEM ─────────────────────────────────────────────────────
    _applyBestFriend(f1, f2) {
        if (!f1.dynamic_state) f1.dynamic_state = {};
        if (!f2.dynamic_state) f2.dynamic_state = {};
        if (!f1.dynamic_state.best_friend_id) f1.dynamic_state.best_friend_id = f2.id;
        if (!f2.dynamic_state.best_friend_id) f2.dynamic_state.best_friend_id = f1.id;
    },

    // Weekly passive morale bonus for best friends + partners in same club
    applyWeeklyBonds(clubId) {
        const gs = window.GameState;
        const club = gs.getClub(clubId);
        if (!club || !club.fighter_ids) return;

        club.fighter_ids.forEach(fId => {
            const f = gs.getFighter(fId);
            if (!f || !f.dynamic_state) return;

            // Best friend bonus
            const bfId = f.dynamic_state.best_friend_id;
            if (bfId && club.fighter_ids.includes(bfId)) {
                f.dynamic_state.morale = Math.min(100, (f.dynamic_state.morale || 50) + 5);
            }

            // Partner bonus (committed relationship in same club)
            const ppId = f.dynamic_state.primary_partner_id;
            if (ppId && club.fighter_ids.includes(ppId)) {
                f.dynamic_state.morale = Math.min(100, (f.dynamic_state.morale || 50) + 3);
            }

            // Best friend injured penalty
            if (bfId) {
                const bf = gs.getFighter(bfId);
                if (bf && bf.dynamic_state?.injuries?.length > 0) {
                    f.dynamic_state.stress = Math.min(100, (f.dynamic_state.stress || 20) + 2);
                }
            }
        });
    },

    // ── MATCH HOOKS ───────────────────────────────────────────────────────────
    hookIntoMatchResult(winnerId, loserId) {
        const gs = window.GameState;
        let fW = gs.getFighter(winnerId);
        let fL = gs.getFighter(loserId);
        if (!fW || !fL) return;

        let rW = this.getRelationship(winnerId, loserId);
        if (!rW) return;

        if (rW.type === 'bitter_rivals') {
            fW.dynamic_state.morale = Math.min(100, (fW.dynamic_state.morale || 50) + 15);
            fL.dynamic_state.stress = Math.min(100, (fL.dynamic_state.stress || 20) + 20);
            rW.dominant_partner_id = winnerId; // Winner asserts dominance in rivalry
        } else if (rW.type === 'obsession') {
            fW.dynamic_state.morale = Math.min(100, (fW.dynamic_state.morale || 50) + 10);
            fL.dynamic_state.morale = Math.max(0, (fL.dynamic_state.morale || 50) - 10);
        } else if (rW.type === 'committed') {
            // Beating your partner stings — but some enjoy proving dominance
            fW.dynamic_state.morale = Math.min(100, (fW.dynamic_state.morale || 50) + 5);
            fL.dynamic_state.morale = Math.max(0, (fL.dynamic_state.morale || 50) - 8);
        }

        this.addTension(winnerId, loserId, 15, 'Fought each other in a league match.');
    },

    hookIntoSparring(fighter1Id, fighter2Id) {
        const gs = window.GameState;
        let f1 = gs.getFighter(fighter1Id);
        let f2 = gs.getFighter(fighter2Id);
        if (!f1 || !f2) return;

        let r1 = this.getRelationship(fighter1Id, fighter2Id);
        if (!r1) return;

        if (['mentor', 'attraction', 'committed', 'best_friends'].includes(r1.type)) {
            f1.dynamic_state.morale = Math.min(100, (f1.dynamic_state.morale || 50) + 5);
            f2.dynamic_state.morale = Math.min(100, (f2.dynamic_state.morale || 50) + 5);
        }

        this.addTension(fighter1Id, fighter2Id, 10, 'Sparred together in training.');
    },

    hookIntoPostMatchPunishment(winnerId, loserId) {
        this.addTension(winnerId, loserId, 12, 'Subject to severe post-match punishment.');
    },

    // ── INTERNAL HELPERS ──────────────────────────────────────────────────────
    _getRelKey(id1, id2) {
        return [id1, id2].sort().join('-');
    },

    getRelationship(id1, id2) {
        if (id1 === id2) return null;

        const gs = window.GameState;
        if (!gs.relationshipGraph) gs.relationshipGraph = {};

        const key = this._getRelKey(id1, id2);

        if (!gs.relationshipGraph[key]) {
            gs.relationshipGraph[key] = {
                f1: id1,
                f2: id2,
                tension: 0,
                type: 'neutral',
                milestone_reached: 0,
                history: [],
                last_interaction_week: 0,
                dominant_partner_id: null
            };
        }

        return gs.relationshipGraph[key];
    },

    _updatePowerDynamics(f1, f2, rel) {
        // Determines who is the "Alpha" in the relationship based on Dominance Hunger & Submissive Lean
        if (!f1 || !f2 || !rel) return;

        const d1 = f1.personality?.dominance_hunger || 50;
        const d2 = f2.personality?.dominance_hunger || 50;

        if (d1 > d2 + 10) rel.dominant_partner_id = f1.id;
        else if (d2 > d1 + 10) rel.dominant_partner_id = f2.id;
        else rel.dominant_partner_id = null; // Equal footing
    },

    // Evaluates what happens to a relationship when one partner transfers to another club
    evaluateTransferFallout(fighterId) {
        const gs = window.GameState;
        const fighter = gs.getFighter(fighterId);
        if (!fighter || !fighter.dynamic_state) return;

        const partnerId = fighter.dynamic_state.primary_partner_id;
        if (!partnerId) return; // Only care about committed relationships

        const partner = gs.getFighter(partnerId);
        if (!partner) return;

        // If they end up in the same club anyway, no fallout
        if (fighter.club_id === partner.club_id) return;

        const rel = this.getRelationship(fighter.id, partner.id);
        if (!rel) return;

        // Do they break up or try long distance?
        // High dominance/ego and low loyalty leads to bitter breakups. Submissive/high loyalty try to hold on.
        const fLoyalty = (fighter.personality?.loyalty || 50);
        const pLoyalty = (partner.personality?.loyalty || 50);

        // If average loyalty is high, they try long distance. Otherwise, it shatters.
        if ((fLoyalty + pLoyalty) / 2 > 60) {
            rel.history.push(`Week ${gs.week}, S${gs.currentSeason || 1}: Separated by transfer, attempting to stay committed long-distance.`);
            fighter.dynamic_state.stress = Math.min(100, (fighter.dynamic_state.stress || 0) + 15);
            partner.dynamic_state.stress = Math.min(100, (partner.dynamic_state.stress || 0) + 15);
            gs.addNews('relationships', `💔 ${fighter.name} and ${partner.name} are attempting to maintain their relationship despite fighting for rival clubs.`);
        } else {
            // Messy Breakup
            this._breakUpCouple(fighter, partner);
            rel.type = 'bitter_rivals';
            rel.history.push(`Week ${gs.week}, S${gs.currentSeason || 1}: Transfer caused a highly bitter and public breakup.`);

            fighter.dynamic_state.morale = Math.max(0, (fighter.dynamic_state.morale || 50) - 25);
            partner.dynamic_state.morale = Math.max(0, (partner.dynamic_state.morale || 50) - 25);

            gs.addNews('relationships', `💔 SCANDAL: The transfer of ${fighter.name} has caused a highly public and bitter breakup with ${partner.name}! They are now sworn enemies.`);
        }
    }
};