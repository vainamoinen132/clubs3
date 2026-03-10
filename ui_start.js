/**
 * ui_start.js
 * Renders the landing screen: New Game, Load Game, Club Selection.
 */

window.UIStart = {
    render(container) {
        // We will take over the entire app container or just the main view for start
        // Actually, let's keep it simple by mounting it in a dedicated overlay or replacing app-container content
        // In index.html we'll add a #start-screen div
        const startDiv = document.getElementById('start-screen');
        if (!startDiv) return;

        startDiv.classList.add('active');
        document.getElementById('main-nav').classList.add('hidden');
        document.getElementById('main-view').classList.add('hidden');

        const hasSave = localStorage.getItem(window.SaveSystem.saveKey) !== null;

        startDiv.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; width:100%;">
                <div class="glass-panel" style="padding: 3rem 3.5rem; text-align: center; max-width: 480px; width: 90%; border-top: 3px solid var(--accent);">
                    <p style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--text-dim); margin-bottom: 0.5rem; font-weight: 600;">Queens of the Ring</p>
                    <h1 class="font-outfit text-gradient" style="font-size: 2.6rem; margin-bottom: 0.3rem; letter-spacing: -0.03em;">Club Dynasty</h1>
                    <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2rem;">Build your legacy. Train your fighters. Dominate the league.</p>
                    
                    ${hasSave ? `<button class="btn-primary" style="width: 100%; margin-bottom: 0.7rem; padding: 0.9rem; font-size: 1rem; background: linear-gradient(135deg, #00c853, #00e676);" onclick="window.UIStart.loadGame()">Continue Saved Game</button>` : ''}
                    
                    <button class="btn-primary" style="width: 100%; margin-bottom: 0.7rem; padding: 0.9rem; font-size: 1rem;" onclick="window.UIStart.showClubSelection()">New Game</button>

                    <div style="display: flex; gap: 0.6rem; margin-top: 0.8rem;">
                        ${hasSave ? `<button class="btn-secondary" style="flex: 1; padding: 0.65rem; font-size: 0.8rem;" onclick="window.SaveSystem.exportSaveFile()">Export Save</button>` : ''}
                        <button class="btn-secondary" style="flex: 1; padding: 0.65rem; font-size: 0.8rem;" onclick="document.getElementById('save-upload').click()">Import Save</button>
                        <input type="file" id="save-upload" style="display:none;" accept=".json" onchange="window.SaveSystem.importSaveFile(event)">
                    </div>
                </div>
                <p style="margin-top: 1.5rem; font-size: 0.68rem; color: var(--text-dim); letter-spacing: 0.05em;">v1.0 &mdash; A Management Simulation</p>
            </div>
        `;
    },

    loadGame() {
        if (window.SaveSystem.loadGame()) {
            this._launchToDashboard();
        } else {
            alert("Failed to load save.");
        }
    },

    showClubSelection() {
        const startDiv = document.getElementById('start-screen');
        const clubs = Object.values(window.GameState.clubs);

        let clubsHtml = clubs.map(c => `
            <div class="glass-panel hoverable" style="padding: 1rem; cursor: pointer; border-left: 4px solid ${c.color || '#FF3366'};" onclick="window.UIStart.startNewGame('${c.id}')">
                <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">${window.UIComponents.createClubBadge(c)}</div>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 5px;">Advantage: ${window.UIClubs ? window.UIClubs._getHomeAdvantageLabel(c.home_advantage) : (c.home_advantage || 'none').replace(/_/g, ' ')}</p>
                <p style="font-size: 0.85rem; color: var(--text-muted);">Starting Funds: $${(c.money || 100000).toLocaleString()}</p>
            </div>
        `).join('');

        startDiv.innerHTML = `
            <div style="max-width: 780px; margin: 0 auto; padding: 2rem;">
                <p style="text-align:center; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); margin-bottom: 0.4rem; font-weight: 600;">Step 1</p>
                <h1 class="font-outfit text-gradient" style="text-align: center; margin-bottom: 0.4rem; font-size: 2rem;">Choose Your Club</h1>
                <p style="text-align:center; color: var(--text-muted); font-size: 0.85rem; margin-bottom: 2rem;">Each club has a unique identity and starting advantage.</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    ${clubsHtml}
                </div>
                <div style="text-align: center; margin-top: 1.5rem;">
                    <button class="btn-secondary" style="padding: 0.6rem 2rem;" onclick="window.UIStart.render(document.getElementById('start-screen'))">Back</button>
                </div>
            </div>
        `;
    },

    startNewGame(clubId) {
        const gs = window.GameState;
        gs.playerClubId = clubId;

        // Apply Global Start Advantages to All Clubs
        Object.values(gs.clubs).forEach(club => {
            // Baseline 100k
            club.money = club.money || 100000;
            club.facilities = club.facilities || { gym: 1, recovery: 1, pr: 1 };
            club.staff = club.staff || {};

            if (club.home_advantage === 'economy_rich') {
                club.money += 50000; // Small bonus, standard config remains 100k
            }
            else if (club.home_advantage === 'facility_boost') {
                club.facilities.gym = 2;
                club.facilities.recovery = 2;
            }
            else if (club.home_advantage === 'staff_boost') {
                // Find a budget coach from the pool
                let coachIdx = gs.staffPool.findIndex(id => gs.staff[id].role === 'head_coach' && gs.staff[id].tier === 'budget');
                if (coachIdx !== -1) {
                    club.staff['head_coach'] = gs.staffPool[coachIdx];
                    gs.staffPool.splice(coachIdx, 1);
                }
            }

            // If this is the player club, synchronize global money
            if (club.id === gs.playerClubId) {
                gs.money = club.money;
            } else {
                // Initial AI Club setup
                if (window.AIEngine) {
                    // Give them an initial sponsor
                    window.AIEngine._runAISponsorSigning(club);

                    // Give them initial facilities based on their personality
                    // Run it multiple times to simulate them spending their starting funds
                    for (let i = 0; i < 3; i++) {
                        window.AIEngine._runAIFacilitySpending(club);
                    }

                    // Hire staff
                    window.AIEngine._runAIStaffHiring(club);
                }
            }
        });

        // Wipe old save if any
        window.SaveSystem.clearSave();

        // Generate initial Free Agents
        if (window.AITransfers && window.AITransfers._generateProspects) {
            window.AITransfers._generateProspects();
        }

        // Generate Schedule
        if (window.SimSchedule) window.SimSchedule.generateSeasonSchedule();

        this._launchToDashboard();
    },

    _launchToDashboard() {
        // Hide start screen, show main app
        document.getElementById('start-screen').classList.remove('active');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('main-nav').classList.remove('hidden');
        document.getElementById('main-view').classList.remove('hidden');

        // Init Router
        if (window.Router) {
            window.Router.init();
            window.Router.loadRoute('club');
        }

        if (typeof updateNavUI === 'function') updateNavUI();
    }
};
