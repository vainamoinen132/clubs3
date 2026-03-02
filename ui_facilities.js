/**
 * ui_facilities.js
 * Handle club upgrades affecting passive stat growth.
 */

window.FacilityData = {
    costs: {
        gym: [0, 10000, 30000, 80000, 150000, 250000, 400000, 600000, 850000, 1200000, "MAX"],
        recovery: [0, 12000, 36000, 100000, 180000, 300000, 480000, 720000, 1000000, 1500000, "MAX"],
        pr: [0, 8000, 24000, 60000, 120000, 200000, 300000, 450000, 650000, 900000, "MAX"],
        youth: [0, 20000, 50000, 120000, 220000, 350000, 550000, 800000, 1200000, 2000000, "MAX"] // new
    },
    upkeep: [0, 0, 10000, 30000, 60000, 100000, 160000, 240000, 340000, 460000, 600000] // Length 11, index is level (1-10)
};

window.UIFacilities = {
    render(container, params) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (!club) return;

        // Initialize facility levels if not present
        if (!club.facilities) {
            club.facilities = { gym: 1, recovery: 1, pr: 1, youth: 1 };
        } else if (!club.facilities.youth) {
            club.facilities.youth = 1;
        }

        container.innerHTML = `
            ${window.UIComponents.createSectionHeader('Facilities & Economy', 'Upgrade your club infrastructure to gain permanent advantages.')}
            
            <div class="glass-panel" style="padding: 1rem; margin-bottom: 2rem; border-left: 3px solid var(--accent);">
                <span style="font-size: 1.2rem;">Club Funds: <strong style="color:#00e676;">$${gs.money.toLocaleString()}</strong></span>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
                ${this._createFacilityCard('Gymnasium', 'gym', 'Raises Natural Ceilings and Training effectiveness.', club.facilities.gym, window.FacilityData.costs.gym)}
                ${this._createFacilityCard('Recovery Center', 'recovery', 'Increases weekly fatigue recovery.', club.facilities.recovery, window.FacilityData.costs.recovery)}
                ${this._createFacilityCard('PR Department', 'pr', 'Multiplies Fame and Sponsorships.', club.facilities.pr, window.FacilityData.costs.pr)}
                ${this._createFacilityCard('Youth Academy', 'youth', 'Graduates a free prospect each year (Quality scales with level).', club.facilities.youth, window.FacilityData.costs.youth)}
            </div>
        `;

        setTimeout(() => {
            container.querySelectorAll('.btn-upgrade').forEach(b => {
                b.addEventListener('click', (e) => {
                    this._upgradeFacility(e.currentTarget.getAttribute('data-fac'), club);
                });
            });
        }, 0);
    },

    _createFacilityCard(name, key, desc, level, costs) {
        let cost = costs[level];
        let costStr = typeof cost === 'number' ? `$${cost.toLocaleString()}` : cost;
        let btnDisabled = (typeof cost !== 'number' || window.GameState.money < cost) ? "disabled" : "";
        let btnStyle = btnDisabled ? "background: #444; color: #888; cursor: not-allowed;" : "";

        // Annual upkeep
        let maintCost = window.FacilityData.upkeep[Math.min(level, 10)];

        return `
            <div class="glass-panel" style="padding: 1.5rem; text-align: center;">
                <h3 style="margin-bottom: 0.5rem; font-family: var(--font-heading);">${name}</h3>
                <div style="font-size: 1.5rem; color: var(--accent); margin-bottom: 0.5rem;">Level ${level}</div>
                <div style="font-size: 0.85rem; color: #ff5252; margin-bottom: 1rem; font-weight:bold;">Upkeep: ${maintCost > 0 ? `-$${maintCost.toLocaleString()}/yr` : '<span style="color:#00e676;">No Upkeep</span>'}</div>
                <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; height: 40px;">${desc}</p>
                <button class="btn-primary btn-upgrade" data-fac="${key}" ${btnDisabled} style="width: 100%; ${btnStyle}">
                    Upgrade (${costStr})
                </button>
            </div>
        `;
    },

    _upgradeFacility(key, club) {
        let currentLevel = club.facilities[key];
        let cost = window.FacilityData.costs[key][currentLevel];

        if (typeof cost === 'number' && window.GameState.money >= cost) {
            window.GameState.money -= cost;
            club.facilities[key]++;
            console.log(`Upgraded ${key} to Level ${club.facilities[key]}`);

            if (typeof updateNavUI === 'function') updateNavUI();
            window.Router.loadRoute('facilities'); // redraw
        }
    },

};
