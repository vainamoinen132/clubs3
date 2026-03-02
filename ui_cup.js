/**
 * ui_cup.js
 * Handles the Mid-Season Knockout Tournament.
 */

window.UICup = {
    selectedFighterIds: [], // State to track selected fighters before generating tournament

    render(container, params) {
        const gs = window.GameState;

        if (!gs.midSeasonCup) {
            this.renderSelection(container);
            return;
        }

        const cup = gs.midSeasonCup;

        if (cup.isComplete) {
            this._renderComplete(container, cup);
            return;
        }

        let html = `
            <div class="dashboard-header" style="border-bottom-color: #d4af37;">
                <h2 style="color: #d4af37; text-transform: uppercase;">The Mid-Season Cup</h2>
                <div class="header-stats">
                    <div class="stat-badge" style="background: rgba(212,175,55,0.2); border-color: #d4af37; color: #d4af37;">
                        Round: ${['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Grand Final'][cup.round - 1]}
                    </div>
                </div>
            </div>
            <p style="color: #ccc; margin-bottom: 20px; font-style: italic;">
                The best 2 fighters from every club clash in a 16-roster knockout tournament. 
                Winner takes $30,000.
            </p>
        `;

        html += `<div id="cup-bracket" style="display:flex; flex-wrap:wrap; gap:15px; margin-bottom: 30px;">`;

        let unplayedPlayerMatches = [];

        cup.matches.forEach((m, idx) => {
            let isPlayer = cup.playerFighterIds.includes(m.f1.id) || cup.playerFighterIds.includes(m.f2.id);
            let bgColor = isPlayer ? 'rgba(212,175,55,0.1)' : 'rgba(0,0,0,0.4)';
            let borderColor = isPlayer ? '#d4af37' : '#444';

            // Fallbacks in case generation failed to populate exactly 16 valid fighters
            let f1Name = m.f1 ? m.f1.name : "TBD";
            let f1Club = (m.f1 && gs.getClub(m.f1.club_id)) ? gs.getClub(m.f1.club_id).name : "Unknown";
            let f2Name = m.f2 ? m.f2.name : "TBD";
            let f2Club = (m.f2 && gs.getClub(m.f2.club_id)) ? gs.getClub(m.f2.club_id).name : "Unknown";

            let f1Color = (isPlayer && m.f1 && cup.playerFighterIds.includes(m.f1.id)) ? '#fff' : '#888';
            let f2Color = (isPlayer && m.f2 && cup.playerFighterIds.includes(m.f2.id)) ? '#fff' : '#888';

            html += `
                <div style="width:calc(50% - 15px); padding:15px; border:1px solid ${borderColor}; background:${bgColor}; border-radius:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap: 10px;">
                            ${m.f1 ? window.UIComponents.createFighterAvatarHtml(m.f1, 40) : '<div style="width:40px;height:40px;background:#333;border-radius:50%;"></div>'}
                            <div style="display:flex; flex-direction:column;">
                                <span style="color:${f1Color}; font-weight:bold;">${f1Name}</span>
                                <span style="font-size:0.75rem; color:#888;">${f1Club}</span>
                            </div>
                        </div>
                        <span style="color:#d4af37; font-weight:bold; font-size:1.2rem; margin: 0 10px;">VS</span>
                        <div style="display:flex; align-items:center; gap: 10px; flex-direction: row-reverse; text-align: right;">
                            ${m.f2 ? window.UIComponents.createFighterAvatarHtml(m.f2, 40) : '<div style="width:40px;height:40px;background:#333;border-radius:50%;"></div>'}
                            <div style="display:flex; flex-direction:column;">
                                <span style="color:${f2Color}; font-weight:bold;">${f2Name}</span>
                                <span style="font-size:0.75rem; color:#888;">${f2Club}</span>
                            </div>
                        </div>
                    </div>
            `;

            if (m.winner) {
                html += `<div style="margin-top:10px; padding:5px; background:rgba(0,0,0,0.5); font-size:0.8rem; color:#ccc;"><strong>${m.winner.name} won.</strong></div>`;
            } else if (isPlayer) {
                unplayedPlayerMatches.push(idx);
                html += `<button class="btn-primary" style="width:100%; margin-top:10px; background:#d4af37; color:#000;" onclick="window.UICup.playMatch(${idx})">FIGHT NOW</button>`;
            } else {
                html += `<div style="text-align:center; color:#666; font-style:italic; margin-top:10px;">Pending Simulation...</div>`;
            }

            html += `</div>`;
        });

        html += `</div>`;

        if (unplayedPlayerMatches.length === 0) {
            html += `
                <div style="text-align: center; margin-top: 2rem;">
                    <button id="btn-cup-continue" class="btn-primary" style="padding:15px 30px; font-size:1.2rem;" onclick="window.UICup.advanceBracket()">RESOLVE ROUND</button>
                </div>
            `;
        } else {
            html += `<div style="text-align: center; margin-top: 2rem; color: #888;">Play your scheduled match(es) to proceed.</div>`;
        }

        container.innerHTML = html;
    },

    renderSelection(container) {
        const gs = window.GameState;
        let club = gs.getClub(gs.playerClubId);
        let availableFighters = club.fighter_ids.map(id => gs.getFighter(id))
            .filter(f => f && (!f.dynamic_state.injuries || f.dynamic_state.injuries.length === 0));

        let maxSelectable = Math.min(2, availableFighters.length);

        if (maxSelectable === 0) {
            // Player has no valid fighters, immediately auto-generate with generic replacements or just skip them
            this.generateTournament();
            return;
        }

        let html = `
            <div class="dashboard-header" style="border-bottom-color: #d4af37;">
                <h2 style="color: #d4af37; text-transform: uppercase;">The Mid-Season Cup: Selection Phase</h2>
            </div>
            <p style="color: #ccc; margin-bottom: 20px; font-style: italic;">
                The prestigious Mid-Season Cup is about to begin. Select up to ${maxSelectable} available fighters to represent your club.
            </p>
        `;

        html += `<div style="display:flex; flex-wrap:wrap; gap:15px; margin-bottom: 30px;">`;

        availableFighters.forEach(f => {
            let isSelected = this.selectedFighterIds.includes(f.id);
            let borderStyle = isSelected ? 'border: 2px solid #d4af37; background: rgba(212,175,55,0.2);' : 'border: 1px solid #444; background: rgba(0,0,0,0.4);';

            html += `
                <div style="width:calc(33% - 15px); padding:15px; border-radius:8px; cursor: pointer; transition: 0.2s; ${borderStyle}"
                     onclick="window.UICup.toggleSelection('${f.id}', ${maxSelectable})"
                     onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        ${window.UIComponents.createFighterAvatarHtml(f, 60)}
                        <div style="display:flex; flex-direction:column;">
                            <span style="color: #fff; font-weight:bold; font-size:1.1rem;">${f.name}</span>
                            <span style="color: #bbb; font-size:0.9rem;">OVR: ${Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3)}</span>
                            <span style="color: #e57373; font-size:0.8rem;">Fatigue: ${f.dynamic_state.fatigue || 0}%</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        let canSubmit = this.selectedFighterIds.length === maxSelectable;
        html += `
            <div style="text-align: center; margin-top: 2rem;">
                <button class="${canSubmit ? 'btn-primary' : 'btn-disabled'}" 
                        style="padding:15px 30px; font-size:1.2rem; ${canSubmit ? 'background:#d4af37; color:#000;' : ''}"
                        ${canSubmit ? 'onclick="window.UICup.generateTournament()"' : ''}>
                    SUBMIT ENTRY
                </button>
            </div>
        `;

        container.innerHTML = html;
    },

    toggleSelection(fighterId, maxSelectable) {
        let idx = this.selectedFighterIds.indexOf(fighterId);
        if (idx > -1) {
            this.selectedFighterIds.splice(idx, 1);
        } else {
            if (this.selectedFighterIds.length < maxSelectable) {
                this.selectedFighterIds.push(fighterId);
            }
        }
        // Re-render selection
        this.renderSelection(document.getElementById('main-view'));
    },

    _renderComplete(container, cup) {
        let html = `
            <div class="panel" style="text-align:center; border-color:#d4af37; padding:40px;">
                <h1 style="color:#d4af37; font-size:3rem; margin-bottom:10px;">CUP CHAMPION</h1>
                <h2>${cup.champion.name} (${window.GameState.getClub(cup.champion.club_id).name})</h2>
                <p style="color:#ccc; margin-top: 20px;">The mid-season tournament is over. The league resumes.</p>
                <button class="btn-primary" style="margin-top:30px; background:#d4af37; color:#000;" onclick="window.UICup.exitCup()">Resume League (Week 8)</button>
            </div>
            
            <h3 style="margin-top: 30px; color: #d4af37;">Tournament History</h3>
            <div class="panel" style="margin-top: 10px; color: #ccc; font-size: 0.9rem; line-height: 1.6;">
                ${cup.logs.map(l => `<p style="margin-bottom: 15px;">${l}</p>`).join('')}
            </div>
        `;
        container.innerHTML = html;
    },

    generateTournament() {
        const gs = window.GameState;
        let pool = [];
        let playerFighterIds = [];

        Object.keys(gs.clubs).forEach(clubId => {
            let club = gs.clubs[clubId];
            if (club.fighter_ids.length === 0) return;

            let reps = [];

            if (clubId === gs.playerClubId && this.selectedFighterIds.length > 0) {
                // Use player selections
                reps = this.selectedFighterIds.map(id => gs.getFighter(id)).filter(f => f);
                playerFighterIds.push(...reps.map(r => r.id));
                gs.addNews('global', `Manager selected ${reps.map(r => r.name).join(' and ')} to represent the club in the Mid-Season Cup.`);
            } else {
                // Auto-select the top 2 fighters for AI based on OVR prioritizing freshness
                let sorted = club.fighter_ids.map(id => gs.getFighter(id))
                    .filter(f => f && (!f.dynamic_state.injuries || f.dynamic_state.injuries.length === 0))
                    .sort((a, b) => {
                        let aOvr = (a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3;
                        let bOvr = (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3;
                        let aScore = aOvr - (a.dynamic_state.fatigue || 0) * 0.5;
                        let bScore = bOvr - (b.dynamic_state.fatigue || 0) * 0.5;
                        return bScore - aScore;
                    });
                reps = sorted.slice(0, 2);
            }

            pool.push(...reps);
        });

        // If for some reason we don't have exactly 16, pad with underground fighters
        // We filter out any undefined/null reps that may have slipped in due to empty clubs
        pool = pool.filter(f => f && f.id);

        while (pool.length < 16) {
            let ug = window.UndergroundEngine.generateFighter(1);
            if (ug) pool.push(ug);
        }

        // Trim if > 16 just in case
        pool = pool.slice(0, 16);

        // Shuffle pool
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        let matches = [];
        for (let i = 0; i < 16; i += 2) {
            matches.push({
                f1: pool[i],
                f2: pool[i + 1],
                winner: null
            });
        }

        gs.midSeasonCup = {
            round: 1, // 1: Ro16, 2: Quarters, 3: Semis, 4: Final
            matches: matches,
            playerFighterIds: playerFighterIds,
            logs: [],
            isComplete: false,
            champion: null,
            semiFinalistsCounted: false
        };

        // Clear selection state
        this.selectedFighterIds = [];

        // Re-render the tournament bracket now that it's generated
        this.render(document.getElementById('main-view'));
    },

    playMatch(matchIndex) {
        const gs = window.GameState;
        let cup = gs.midSeasonCup;
        let m = cup.matches[matchIndex];

        let pId = cup.playerFighterIds.includes(m.f1.id) ? m.f1.id : m.f2.id;
        let oId = pId === m.f1.id ? m.f2.id : m.f1.id;

        // Pass context to UIMatch
        window.UIMatch.startUndergroundMatch(pId, oId, { type: 'midseasoncup', matchIndex: matchIndex });
    },

    processPlayerMatchResult(winner, loser, context) {
        const gs = window.GameState;
        let cup = gs.midSeasonCup;
        let m = cup.matches[context.matchIndex];

        m.winner = m.f1.id === winner.id ? m.f1 : m.f2;

        // Go back to cup bracket
        this.render(document.getElementById('main-view'));
    },

    advanceBracket() {
        const gs = window.GameState;
        let cup = gs.midSeasonCup;
        let winners = [];
        let rLogs = [];

        cup.matches.forEach(m => {
            if (!m.winner) {
                // AI vs AI simulate
                let style = ['boxing', 'naked_wrestling', 'catfight', 'sexfight'][Math.floor(Math.random() * 4)];
                let sim = new MatchSimulation(m.f1, m.f2, style, false);
                sim.startMatch();
                while (!sim.winner) { sim.playRound(); }

                m.winner = sim.winner.id === m.f1.id ? m.f1 : m.f2;

                // Fatigue and stats handled entirely by SimEvents.processPostMatch below

                // Track Hall of Fame stats
                if (window.SimEvents && window.SimEvents.processPostMatch) {
                    let loser = sim.winner.id === sim.f1.id ? sim.f2 : sim.f1;
                    let roundDiff = Math.abs(sim.roundsWon.f1 - sim.roundsWon.f2);
                    window.SimEvents.processPostMatch(sim.winner.id, loser.id, roundDiff, style);
                }
            }
            winners.push(m.winner);
            let loser = m.winner.id === m.f1.id ? m.f2 : m.f1;
            rLogs.push(`${m.winner.name} beat ${loser.name}`);
        });

        cup.logs.push(`<strong>Round ${cup.round} Results:</strong> ` + rLogs.join(" | "));

        // Pay semi-finalists if round 3 (Semis) just finished
        if (cup.round === 3) {
            cup.matches.forEach(m => {
                let loser = m.winner.id === m.f1.id ? m.f2 : m.f1;
                this._payClub(loser.club_id, 7500);
            });
        }

        if (winners.length === 1) {
            cup.champion = winners[0];
            cup.isComplete = true;

            // Pay winner and runner-up (which just lost in round 4)
            let finalMatch = cup.matches[0];
            let runnerUp = finalMatch.winner.id === finalMatch.f1.id ? finalMatch.f2 : finalMatch.f1;

            this._payClub(cup.champion.club_id, 30000);
            this._payClub(runnerUp.club_id, 15000);

            gs.addNews('global', `🏆 ${cup.champion.name} (${gs.getClub(cup.champion.club_id).name}) won the Mid-Season Cup and walked away with $30,000!`);

        } else {
            let nextMatches = [];
            for (let i = 0; i < winners.length; i += 2) {
                nextMatches.push({
                    f1: winners[i],
                    f2: winners[i + 1],
                    winner: null
                });
            }
            cup.round++;
            cup.matches = nextMatches;
        }

        this.render(document.getElementById('main-view'));
    },

    _payClub(clubId, amount) {
        const gs = window.GameState;
        if (clubId === gs.playerClubId) {
            gs.money += amount;
            if (typeof updateNavUI === 'function') updateNavUI();
        } else {
            let club = gs.getClub(clubId);
            if (club) club.money = (club.money || 0) + amount;
        }
    },

    exitCup() {
        const gs = window.GameState;
        gs.midSeasonCupCompleted = true;
        gs.midSeasonCupActive = false;

        // Remove tracking so we don't carry this heavy object forever
        // gs.midSeasonCup = null; // Un-comment if memory gets tight, but logs are nice to keep.

        // Advance safely back to dashboard
        window.Router.loadRoute('club');
    }
};
