/**
 * ai_tactics.js
 * Advanced AI tactical decisions for NPC clubs during matches.
 *
 * Stance System Reference (from sim_rounds.js):
 *   aggressive  → 1.2× attack, 0.8× defense
 *   defensive   → 0.8× attack, 1.2× defense
 *   balanced    → 1.0× both
 *   showboat    → 0.9× both, +15% dominance gain
 *
 * Style Primary/Secondary Stats (from sim_rounds.js):
 *   boxing          → technique / speed  (counter: speed)
 *   naked_wrestling → control / power    (counter: power)
 *   catfight        → aggression / power (counter: power)
 *   sexfight        → composure / presence (counter: presence)
 *
 * Defense always uses: resilience×0.4 + composure×0.3 + counter×0.3
 */

window.AITactics = {

    // ── STYLE → STAT MAPPING (mirrors sim_rounds.js) ──────────────────────
    _styleStats: {
        boxing:           { primary: 'technique', secondary: 'speed',    counter: 'speed' },
        naked_wrestling:  { primary: 'control',   secondary: 'power',    counter: 'power' },
        catfight:         { primary: 'aggression', secondary: 'power',   counter: 'power' },
        sexfight:         { primary: 'composure',  secondary: 'presence', counter: 'presence' }
    },

    // ── HELPER: estimate attack/defense scores (same formula as sim engine) ──
    _estimateAttack(stats, style, affinity) {
        const sc = this._styleStats[style] || this._styleStats.boxing;
        return (stats[sc.primary] || 50) * 0.5 + (stats[sc.secondary] || 50) * 0.3 + (affinity || 50) * 0.2;
    },

    _estimateDefense(stats, style) {
        const sc = this._styleStats[style] || this._styleStats.boxing;
        return (stats.resilience || 50) * 0.4 + (stats.composure || 50) * 0.3 + (stats[sc.counter] || 50) * 0.3;
    },

    // ── HELPER: compute a fighter's "edge" over their opponent ──────────────
    // Positive = our fighter is stronger offensively, negative = opponent is stronger
    _computeEdge(fighter, opponent, style) {
        const fStats = fighter.core_stats || fighter.currentStats || {};
        const oStats = opponent.core_stats || opponent.currentStats || {};
        const fAff = (fighter.style_affinities || fighter.affinities || {})[style] || 50;
        const oAff = (opponent.style_affinities || opponent.affinities || {})[style] || 50;

        const fAtk = this._estimateAttack(fStats, style, fAff);
        const fDef = this._estimateDefense(fStats, style);
        const oAtk = this._estimateAttack(oStats, style, oAff);
        const oDef = this._estimateDefense(oStats, style);

        return {
            offensiveEdge: fAtk - oDef,  // how much we out-attack their defense
            defensiveEdge: fDef - oAtk,   // how much we out-defend their attack
            netEdge: (fAtk - oDef) + (fDef - oAtk), // overall advantage
            fAtk, fDef, oAtk, oDef
        };
    },

    /**
     * ── INITIAL STANCE SELECTION ─────────────────────────────────────────────
     * Called once before the match starts. Factors:
     * 1. Stat matchup analysis (offensive vs defensive edge)
     * 2. Style affinity comparison
     * 3. Opponent archetype counter-play
     * 4. Club persona tendencies
     * 5. Fighter fatigue & form awareness
     */
    getInitialStance(club, opponentClub, fighter, opponent, matchStyle) {
        const style = matchStyle || 'boxing';
        const persona = club.ai_persona || 'balanced';
        const edge = this._computeEdge(fighter, opponent, style);

        const fFatigue = fighter.dynamic_state?.fatigue || 0;
        const fForm = fighter.dynamic_state?.form || 50;
        const oFatigue = opponent.dynamic_state?.fatigue || 0;

        const fAff = (fighter.style_affinities || {})[style] || 50;
        const oAff = (opponent.style_affinities || {})[style] || 50;

        // --- STRATEGY 1: Strong offensive edge → go aggressive to capitalize ---
        if (edge.offensiveEdge > 12 && fFatigue < 50) {
            return 'aggressive';
        }

        // --- STRATEGY 2: Strong defensive edge, weak offense → turtle and outlast ---
        if (edge.defensiveEdge > 12 && edge.offensiveEdge < -5) {
            return 'defensive';
        }

        // --- STRATEGY 3: Massive style affinity advantage → press it ---
        if (fAff - oAff > 25 && fFatigue < 60) {
            return 'aggressive';
        }

        // --- STRATEGY 4: Opponent is exhausted → attack relentlessly ---
        if (oFatigue > 70 && fFatigue < 50) {
            return 'aggressive';
        }

        // --- STRATEGY 5: Our fighter is fatigued → conserve energy ---
        if (fFatigue > 65) {
            return 'defensive';
        }

        // --- STRATEGY 6: Archetype counter-play ---
        const oArch = (opponent.personality || {}).archetype || '';
        if (oArch === 'Showboat' || oArch === 'Brawler') {
            // Showboats/Brawlers over-commit — defensive stance punishes them
            return 'defensive';
        }
        if (oArch === 'Underdog') {
            // Underdogs rally when behind — go aggressive early to prevent that
            return 'aggressive';
        }

        // --- STRATEGY 7: Persona-driven fallback ---
        switch (persona) {
            case 'saboteur':
                return 'aggressive'; // always pressure
            case 'tactician':
                // Tacticians read the matchup; if even, stay balanced
                return edge.netEdge > 5 ? 'aggressive' : edge.netEdge < -5 ? 'defensive' : 'balanced';
            case 'big_spender':
                // Big spenders have better fighters, so press the advantage
                return edge.offensiveEdge > 0 ? 'aggressive' : 'balanced';
            case 'brand_first':
                // Brand clubs love showboating when they have the edge in sexfight/catfight
                if ((style === 'sexfight' || style === 'catfight') && edge.offensiveEdge > 5) return 'showboat';
                return 'balanced';
            case 'talent_developer':
                // Conservative — protect young talent
                return fFatigue > 40 ? 'defensive' : 'balanced';
            default:
                return 'balanced';
        }
    },

    /**
     * ── MID-MATCH STANCE ADJUSTMENT ─────────────────────────────────────────
     * Called after every round. Analyzes the evolving match state to make
     * intelligent in-fight adjustments. Factors:
     * 1. Score differential (ahead/behind/tied)
     * 2. Stamina and health comparison
     * 3. Momentum (win/loss streaks)
     * 4. Round number (urgency awareness)
     * 5. Opponent weakness exploitation
     */
    getMidMatchStanceAdjustment(club, fighter, opponent, currentStance, roundState) {
        const persona = club.ai_persona || 'balanced';
        const stamina = fighter.stamina ?? 100;
        const health = fighter.health ?? 100;
        const oStamina = opponent?.stamina ?? 100;
        const oHealth = opponent?.health ?? 100;

        const behindBy = roundState.behindBy || 0;    // positive = losing
        const aheadBy = roundState.aheadBy || 0;       // positive = winning
        const roundNum = roundState.roundNumber || 1;
        const fStreak = roundState.myStreak || 0;       // consecutive rounds won
        const oStreak = roundState.oppStreak || 0;      // consecutive rounds lost

        // ── CRITICAL: Stamina emergency — switch to defensive to survive ──
        if (stamina < 25) {
            return 'defensive';
        }

        // ── AHEAD BY 3+ — protect the lead, go defensive unless we can finish ──
        if (aheadBy >= 3) {
            // If opponent is also low health/stamina, go for the kill
            if (oHealth < 30 || oStamina < 25) return 'aggressive';
            return 'defensive';
        }

        // ── AHEAD BY 1-2 — stay composed, balanced or slightly defensive ──
        if (aheadBy >= 1 && aheadBy <= 2) {
            if (stamina > 60 && oStamina < 40) return 'aggressive'; // opponent gassing out
            return persona === 'saboteur' ? 'aggressive' : 'balanced';
        }

        // ── BEHIND BY 3+ — desperation mode, must go aggressive ──
        if (behindBy >= 3) {
            return 'aggressive';
        }

        // ── BEHIND BY 2 — need to shift momentum ──
        if (behindBy >= 2) {
            // If we have stamina advantage, go aggressive
            if (stamina > oStamina + 15) return 'aggressive';
            // If low stamina, balanced is safer than aggressive (avoid collapse)
            if (stamina < 40) return 'balanced';
            return 'aggressive';
        }

        // ── BEHIND BY 1 — slight adjustment ──
        if (behindBy === 1) {
            if (stamina > 50 && oStamina < 35) return 'aggressive';
            if (persona === 'tactician' && stamina > 60) return 'aggressive';
            return 'balanced';
        }

        // ── TIED — ride momentum or counter opponent ──
        // On a winning streak, keep pressing
        if (fStreak >= 2 && stamina > 40) {
            return 'aggressive';
        }
        // On a losing streak, reset with defensive round
        if (oStreak >= 2) {
            return 'defensive';
        }

        // ── OPPONENT WEAKNESS EXPLOITATION ──
        if (oStamina < 30 && stamina > 50) return 'aggressive';
        if (oHealth < 25 && stamina > 35) return 'aggressive';

        // ── LATE ROUNDS (8+) — fatigue management ──
        if (roundNum >= 8 && stamina < 45) {
            return 'defensive';
        }

        // ── PERSONA-SPECIFIC MID-FIGHT TENDENCIES ──
        switch (persona) {
            case 'saboteur':
                return stamina > 35 ? 'aggressive' : 'balanced';
            case 'tactician':
                // Tacticians constantly re-evaluate — favor balanced for flexibility
                return oStamina < stamina - 10 ? 'aggressive' : 'balanced';
            case 'brand_first':
                // Showboat when comfortably ahead with stamina
                if (aheadBy >= 1 && stamina > 60) return 'showboat';
                return 'balanced';
            default:
                return currentStance; // no change
        }
    },

    /**
     * ── FIGHTER SELECTION ADVISOR ─────────────────────────────────────────────
     * Used by getSmartFighter in ai_engine.js. Given an opponent's stats and
     * the match style, returns a "counter-score" bonus for a candidate fighter.
     * Rewards fighters whose strengths exploit the opponent's weaknesses.
     */
    getCounterScore(candidate, opponent, style) {
        if (!candidate || !opponent) return 0;

        const cStats = candidate.core_stats || {};
        const oStats = opponent.core_stats || {};
        const sc = this._styleStats[style] || this._styleStats.boxing;

        let score = 0;

        // If opponent is weak in the counter stat, our attacker has a field day
        const oCounterStat = oStats[sc.counter] || 50;
        if (oCounterStat < 45) score += 15; // opponent can't defend this style well
        if (oCounterStat < 35) score += 10; // catastrophically bad

        // If our primary attack stat vastly outclasses their resilience
        const cPrimary = cStats[sc.primary] || 50;
        const oResilience = oStats.resilience || 50;
        if (cPrimary - oResilience > 15) score += 12;

        // Composure mismatch: if opponent has low composure, aggressive fighters dominate
        if ((oStats.composure || 50) < 40 && (cStats.aggression || 50) > 65) score += 10;

        // Endurance mismatch: if opponent has low endurance, long fights favor us
        if ((oStats.endurance || 50) < 40 && (cStats.endurance || 50) > 60) score += 8;

        // Style affinity mismatch
        const cAff = (candidate.style_affinities || {})[style] || 50;
        const oAff = (opponent.style_affinities || {})[style] || 50;
        if (cAff - oAff > 20) score += 10;

        return score;
    }
};
