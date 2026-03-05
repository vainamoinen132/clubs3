/**
 * ui_club.js
 * Renders the Club Dashboard overview.
 */

window.UIClub = {
    render(container, params) {
        const gs = window.GameState;

        // Intercept dashboard to show Poaching Overlays
        if (gs.pendingPoachEvents && gs.pendingPoachEvents.length > 0) {
            this._renderPoachingOverlay(container);
            return;
        }

        // Intercept dashboard to show Relationship Milestone Overlays
        if (gs.pendingMilestones && gs.pendingMilestones.length > 0) {
            this._renderMilestoneOverlay(container);
            return;
        }

        const club = gs.getClub(gs.playerClubId);

        if (!club) {
            container.innerHTML = "<h2>Error: Player Club not set.</h2>";
            return;
        }

        const nextMatch = this._getNextMatch();
        let matchHtml = `<p class="text-muted">No upcoming matches this week.</p>`;

        if (gs.week === 8 && !gs.midSeasonCupCompleted) {
            matchHtml = `
                <div class="glass-panel" style="padding: 1rem; border-left: 4px solid #d4af37; background: rgba(212, 175, 55, 0.05);">
                    <h3 style="margin-bottom: 0.5rem; font-family: var(--font-heading); color:#d4af37;">🏆 Mid-Season Cup</h3>
                    <p style="font-size: 1.2rem;">The 16-Roster Knockout Tournament is live!</p>
                    <button class="btn-primary" style="margin-top: 1rem; background:#d4af37; color:#000;" onclick="window.Router.loadRoute('cup')">Enter Tournament</button>
                </div>
            `;
        }
        else if (gs.week > 14) {
            matchHtml = `
                <div class="glass-panel" style="padding: 1rem; border-left: 4px solid #3b82f6; background: rgba(59, 130, 246, 0.05);">
                    <h3 style="margin-bottom: 0.5rem; font-family: var(--font-heading); color:#3b82f6;">Offseason Training</h3>
                    <p style="font-size: 1.2rem;">Official season matches have concluded. Focus on training, resting, and finalizing roster moves before the next season begins.</p>
                    <button class="btn-primary" style="margin-top: 1rem; background:#3b82f6;" onclick="document.getElementById('btn-advance-week').click()">Advance Offseason Week</button>
                </div>
            `;
        }
        else if (nextMatch) {
            const oppId = nextMatch.home === club.id ? nextMatch.away : nextMatch.home;
            const opp = gs.getClub(oppId) || { name: 'Unknown' };
            matchHtml = `
                <div class="glass-panel" style="padding: 1rem; border-left: 4px solid var(--accent);">
                    <h3 style="margin-bottom: 0.5rem; font-family: var(--font-heading);">Week ${gs.week} Fixture</h3>
                    <p style="font-size: 1.2rem;">vs ${window.UIComponents.createClubBadge(opp)}</p>
                    <button class="btn-primary" style="margin-top: 1rem;" onclick="window.Router.loadRoute('match', { matchId: '${nextMatch.id}' })">Go to Match Event</button>
                </div>
            `;
        }

        // Annual financial projections
        let annualSalaries = 0;
        club.fighter_ids.forEach(id => {
            let f = gs.getFighter(id);
            if (f && f.contract) annualSalaries += f.contract.salary; // already annual
        });
        if (club.staff) {
            // Only count actually-hired coaches (non-null slot values), salary is annual
            Object.values(club.staff).forEach(staffId => {
                if (staffId && gs.staff[staffId]) {
                    annualSalaries += gs.staff[staffId].salary; // already annual
                }
            });
        }
        // Upkeep by facility level: L1=free, L2=$10k/yr, L3=$30k/yr, L4=$60k/yr
        let ut = window.FacilityData ? window.FacilityData.upkeep : [0, 0, 10000, 30000, 60000, 100000, 160000, 240000, 340000, 460000, 600000];
        let annualUpkeep = ut[Math.min(club.facilities?.gym || 1, 10)]
            + ut[Math.min(club.facilities?.recovery || 1, 10)]
            + ut[Math.min(club.facilities?.pr || 1, 10)]
            + ut[Math.min(club.facilities?.youth || 1, 10)];

        container.innerHTML = `
            ${window.UIComponents.createSectionHeader(club.name + ' Dashboard', 'Overview of your club operations.')}
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem;">
                <!-- Main col -->
                <div>
                    <div style="margin-bottom: 2rem;">
                        <h3 class="font-outfit text-gradient" style="margin-bottom: 1rem;">Next Fixture</h3>
                        ${matchHtml}
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
                        <div>
                            <h3 class="font-outfit text-gradient" style="margin-bottom: 1rem;">Club Identity</h3>
                            <div class="glass-panel" style="padding: 1.5rem; height: 100%;">
                                <p><strong>Persona:</strong> <span style="text-transform: capitalize;">${club.ai_persona.replace('_', ' ')}</span></p>
                                <p style="margin-top: 0.5rem;"><strong>Home Advantage:</strong> ${window.UIClubs ? window.UIClubs._getHomeAdvantageLabel(club.home_advantage) : club.home_advantage.replace(/_/g, ' ')}</p>
                            </div>
                        </div>
                        <div>
                            <h3 class="font-outfit text-gradient" style="margin-bottom: 1rem;">Financial Projections</h3>
                            <div class="glass-panel" style="padding: 1.5rem; height: 100%;">
                                <div class="glass-panel" style="padding: 1.5rem; height: 100%;">
                                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.8rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.8rem;">
                                        <span>Current Funds:</span> <strong style="color:#00e676;">$${gs.money.toLocaleString()}</strong>
                                    </div>
                                    <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem; color: #ff9999;">
                                        <span>Annual Salaries:</span> <strong>-$${annualSalaries.toLocaleString()}</strong>
                                    </div>
                                    <div style="display:flex; justify-content:space-between; color: #ff9999;">
                                        <span>Annual Upkeep:</span> <strong>-$${annualUpkeep.toLocaleString()}</strong>
                                    </div>
                                    ${gs.financial_crisis_weeks > 0 ? `<div style="text-align:center; color:#ff5252; font-weight:bold; margin-top: 1rem;">📉 FINANCIAL CRISIS</div>` : ''}
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Sidebar col -->
                <div>
                    <h3 class="font-outfit text-gradient" style="margin-bottom: 1rem;">Top Fighters</h3>
                    <div id="dashboard-fighters"></div>
                </div>
            </div>
        `;

        // Render a couple top fighters
        const df = document.getElementById('dashboard-fighters');
        const sortedFighters = club.fighter_ids
            .map(id => gs.getFighter(id))
            .filter(f => f != null)
            .sort((a, b) => {
                const ovrA = Math.round((a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3);
                const ovrB = Math.round((b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3);
                return ovrB - ovrA;
            });

        sortedFighters.slice(0, 2).forEach(f => {
            df.appendChild(window.UIComponents.createFighterCard(f, () => window.Router.loadRoute('roster')));
        });
    },

    _getNextMatch() {
        const gs = window.GameState;
        return gs.schedule.find(m => m.week === gs.week && (m.home === gs.playerClubId || m.away === gs.playerClubId));
    },

    _renderMilestoneOverlay(container) {
        const gs = window.GameState;
        let milestoneData = gs.pendingMilestones[0];

        // ── BETRAYAL EVENT ───────────────────────────────────────────────────
        if (milestoneData.type === 'BETRAYAL_CONFRONTATION') {
            gs.pendingMilestones.shift(); // consume immediately; resolution buttons do their own routing
            if (window.UIRelationships) {
                window.UIRelationships.renderBetrayalEvent(container, milestoneData);
            }
            return;
        }

        // ── NORMAL RELATIONSHIP MILESTONE ────────────────────────────────────
        let f1 = gs.getFighter(milestoneData.f1);
        let f2 = gs.getFighter(milestoneData.f2);

        let c1 = gs.getClub(f1.club_id)?.color || '#ff5252';
        let c2 = gs.getClub(f2.club_id)?.color || '#4caf50';

        let scene = window.RelationshipScenes ? window.RelationshipScenes.getScene(f1, f2, milestoneData.milestone) : {
            title: `Milestone ${milestoneData.milestone}`,
            text: "A significant relationship event occurred.",
            choices: [{ text: "Continue", effect: (r) => r, result: "" }]
        };

        // Text replacement with text-shadow so dark colors are legible
        let pText = scene.text.replace(/\{F1\}/g, `<span style="color:${c1}; font-weight:bold; text-shadow: 0 0 1px #fff, 0 0 2px rgba(255,255,255,0.8);">${f1.name}</span>`)
            .replace(/\{F2\}/g, `<span style="color:${c2}; font-weight:bold; text-shadow: 0 0 1px #fff, 0 0 2px rgba(255,255,255,0.8);">${f2.name}</span>`);

        let html = `
            ${window.UIComponents.createSectionHeader('Relationship Milestone', 'A critical dynamic is forming between your fighters.')}
        <div class="view-content">
            <div class="panel" style="max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 2rem;">

                <div style="display:flex; justify-content:space-between; width:100%; align-items: center; border-bottom: 1px solid var(--border-glass); padding-bottom: 1rem;">
                    <div style="display:flex; align-items:center; gap: 1rem;">
                        ${f1.avatar ? `<img src="assets/portraits/${f1.avatar}" style="width:60px; height:60px; border-radius:50%; border:2px solid ${c1};">` : ''}
                        <h2 class="font-outfit" style="color:${c1}; font-size:2.5rem; margin:0; text-shadow: 0 0 10px ${c1}44;">${f1.name}</h2>
                    </div>
                    <div style="font-size: 1.5rem; color: var(--text-muted); font-weight:bold;">VS</div>
                    <div style="display:flex; align-items:center; gap: 1rem; flex-direction: row-reverse;">
                        ${f2.avatar ? `<img src="assets/portraits/${f2.avatar}" style="width:60px; height:60px; border-radius:50%; border:2px solid ${c2};">` : ''}
                        <h2 class="font-outfit" style="color:${c2}; font-size:2.5rem; margin:0; text-shadow: 0 0 10px ${c2}44;">${f2.name}</h2>
                    </div>
                </div>

                <div style="background:rgba(0,0,0,0.3); padding: 2rem; border-radius: 8px; border: 1px solid var(--border-glass);">
                    <h3 style="text-align:center; font-style:italic; margin-bottom: 1.5rem; color: #ffeb3b; font-size: 1.8rem;">${scene.title}</h3>
                    <p style="font-size: 1.25rem; line-height:1.7; color: #eaeaea; margin-bottom: 2rem;">${pText}</p>

                    <div id="milestone-result-box" style="margin-top:20px; margin-bottom:20px; color:var(--accent); font-weight:bold; text-align:center; font-size: 1.1rem; min-height: 24px;"></div>

                    <div id="milestone-choices" style="display:flex; flex-direction:column; gap: 1rem;">
                    </div>
                </div>
            </div>
        </div>
        `;

        container.innerHTML = html;
        const cb = document.getElementById('milestone-choices');
        const rb = document.getElementById('milestone-result-box');

        scene.choices.forEach((choice, idx) => {
            let btn = document.createElement('button');
            btn.className = "btn-primary";
            btn.style.padding = "1rem";
            btn.style.fontSize = "1.1rem";

            let cText = choice.text.replace(/\{F1\}/g, f1.name).replace(/\{F2\}/g, f2.name);
            btn.innerText = cText;

            btn.onclick = () => {
                // Apply effects
                let newType = 'neutral';
                if (window.RelationshipEngine) {
                    let rel = window.RelationshipEngine.getRelationship(f1.id, f2.id);
                    newType = choice.effect(rel.type);

                    let oldType = rel.type;
                    rel.type = newType;
                    if (!rel.history) rel.history = [];
                    rel.history.push(`Milestone effect: ${oldType.toUpperCase()} ➔ ${newType.toUpperCase()}`);

                    window.RelationshipEngine._applyExclusivity(f1, f2, rel);
                    window.RelationshipEngine._applyExclusivity(f2, f1, rel);
                }

                if (choice.morale) { f1.dynamic_state.morale += choice.morale; f2.dynamic_state.morale += choice.morale; }
                if (choice.stress) { f1.dynamic_state.stress += choice.stress; f2.dynamic_state.stress += choice.stress; }
                if (choice.fame && choice.fame > 0) gs.fame += choice.fame;

                let cResult = choice.result.replace(/\{F1\}/g, `<span style="color:${c1}; font-weight:bold; text-shadow: 0 0 1px #fff, 0 0 2px rgba(255,255,255,0.8);">${f1.name}</span>`)
                    .replace(/\{F2\}/g, `<span style="color:${c2}; font-weight:bold; text-shadow: 0 0 1px #fff, 0 0 2px rgba(255,255,255,0.8);">${f2.name}</span>`);

                rb.innerHTML = cResult + "<br><br><em>Relationship Type is now: <strong>" + newType.toUpperCase() + "</strong></em>";
                cb.innerHTML = ''; // wipe buttons

                let bCont = document.createElement('button');
                bCont.className = "btn-secondary mt-4";
                bCont.innerText = "Close Event";
                bCont.onclick = () => {
                    gs.pendingMilestones.shift(); // remove from queue
                    window.Router.loadRoute('club'); // re-render dashboard (might hit another milestone)
                };
                cb.appendChild(bCont);
            };
            cb.appendChild(btn);
        });

    },

    _renderPoachingOverlay(container) {
        // LEGACY FALLBACK: In case a save file still has pendingPoachEvents queued from older versions,
        // silently clear them so the player doesn't get soft-locked on an empty screen.
        const gs = window.GameState;
        if (gs.pendingPoachEvents && gs.pendingPoachEvents.length > 0) {
            gs.pendingPoachEvents = [];
        }
        window.Router.loadRoute('club');
    }
};
