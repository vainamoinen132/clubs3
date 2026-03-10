/**
 * ui_components.js
 * Reusable UI widgets and HTML generators.
 */

window.UIComponents = {

    createClubBadge(club) {
        if (!club) return `<span style="display:inline-block; padding: 0.2rem 0.6rem; background: #333; color: #fff; border-radius: 4px; font-weight: bold;">Unknown</span>`;
        return `<span style="display:inline-block; padding: 0.2rem 0.6rem; background: ${club.color || '#333'}; color: #ffffff; border-radius: 4px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">${club.name}</span>`;
    },

    /**
     * Generates an SVG data URI for a fighter's initials portrait.
     * Uses the fighter's club color or a hashed color as the background.
     */
    _makeInitialsAvatar(name, color) {
        // Pick initials (first letter of first + last name, or just first two chars)
        const parts = (name || '?').trim().split(/\s+/);
        const initials = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : (parts[0].substring(0, 2)).toUpperCase();

        // Generate a deterministic hue from name if no color provided
        if (!color || color === '#888') {
            let hash = 0;
            for (let c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
            const h = Math.abs(hash) % 360;
            color = `hsl(${h}, 60%, 35%)`;
        }

        // Darken the color slightly for text contrast ring
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${color};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#111;stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect width="70" height="70" rx="8" fill="url(#g)"/>
  <rect width="70" height="70" rx="8" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" fill="#fff" 
        font-family="'Outfit','Inter',sans-serif" font-size="26" font-weight="700"
        letter-spacing="1">${initials}</text>
</svg>`;
        return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    },

    createFighterCard(fighter, onClick = null) {
        const club = window.GameState.getClub(fighter.club_id) || { color: '#888' };

        const card = document.createElement('div');
        card.className = 'fighter-card glass-panel';
        card.style.borderTop = `4px solid ${club.color}`;

        // Stats abbreviated summary
        const avgCore = Math.round((fighter.core_stats.power + fighter.core_stats.technique + fighter.core_stats.speed) / 3);
        const bestStyle = this._getBestStyle(fighter);

        // Build avatar: try fighter.avatar, then name-based path, then initials SVG as last resort
        const fallbackInitials = this._makeInitialsAvatar(fighter.name, club.color);
        const imgSrc = fighter.avatar
            ? `assets/portraits/${fighter.avatar}`
            : `assets/portraits/${fighter.name.toLowerCase()}.png`;
        const avatarHtml = `<img src="${imgSrc}" class="fighter-portrait-sm" onerror="this.onerror=null; this.src='${fallbackInitials}';" alt="${fighter.name}" />`;

        card.innerHTML = `
            <div style="display: flex; gap: 1rem; margin-bottom: 0.8rem;">
                ${avatarHtml}
                <div style="flex-grow: 1;">
                    <div class="fighter-header" style="margin-bottom: 0.2rem;">
                        <h3>${fighter.name}</h3>
                        <span class="age">Age: ${fighter.age}</span>
                    </div>
                    <div class="fighter-tags" style="margin-bottom: 0;">
                        <span class="tag archetype">${fighter.personality.archetype}</span>
                        <span class="tag form">Form: ${fighter.dynamic_state.form}</span>
                    </div>
                </div>
            </div>
            <div class="fighter-metrics">
                <div class="metric"><span>OVR</span><strong>${avgCore}</strong></div>
                <div class="metric"><span>Wins</span><strong>${fighter.dynamic_state.wins || 0}</strong></div>
                <div class="metric"><span>Best</span><strong style="text-transform:capitalize;">${bestStyle}</strong></div>
                <div class="metric"><span>Morale</span><strong>${fighter.dynamic_state.morale}%</strong></div>
            </div>
            <div class="fighter-bars" style="margin-top: 10px;">
                <div style="font-size: 0.8rem; margin-bottom: 2px;">Fatigue</div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px;">
                    <div style="width: ${fighter.dynamic_state.fatigue}%; height: 100%; background: #FF3366; border-radius: 3px;"></div>
                </div>
            </div>
        `;

        if (typeof onClick === 'function') {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => onClick(fighter));
            card.classList.add('hoverable');
        }

        return card;
    },

    /**
     * Renders a small inline avatar (img tag string) for a fighter — used inside table rows etc.
     */
    createFighterAvatarHtml(fighter, size = 40) {
        const club = window.GameState.getClub(fighter.club_id) || { color: '#888' };
        const fallbackInitials = this._makeInitialsAvatar(fighter.name, club.color);
        const imgSrc = fighter.avatar
            ? `assets/portraits/${fighter.avatar}`
            : `assets/portraits/${fighter.name.toLowerCase()}.png`;
        return `<img src="${imgSrc}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.1);" onerror="this.onerror=null;this.src='${fallbackInitials}';" alt="${fighter.name}"/>`;
    },

    _getBestStyle(fighter) {
        let best = "";
        let max = -1;
        for (let [style, val] of Object.entries(fighter.style_affinities)) {
            if (val > max) { max = val; best = style; }
        }
        let formatted = best.replace('_', ' ');
        if (max >= 90) return `<span style="color:#d4af37; text-shadow:0 0 5px rgba(212,175,55,0.5);">Elite ${formatted}</span>`;
        return formatted;
    },

    createSectionHeader(title, subtitle = "") {
        let html = `<div class="section-header" style="margin-bottom: 1.5rem;">
            <h2 class="font-outfit text-gradient" style="font-size: 1.7rem; letter-spacing: -0.02em;">${title}</h2>`;
        if (subtitle) html += `<p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.2rem;">${subtitle}</p>`;
        html += `</div>`;
        return html;
    },

    closeModal() {
        const modal = document.getElementById('global-modal-overlay');
        if (modal) modal.remove();
    },

    /**
     * Renders an impressive end-of-season summary modal.
     */
    showSeasonHighlights() {
        const gs = window.GameState;
        this.closeModal();

        // Compute standings
        let standings = gs.leagueStandings || [];
        if (standings.length < 2) return;

        let champ = standings[0];
        let champClub = gs.getClub(champ.id);
        let relegated = standings[standings.length - 1];
        let relegatedClub = gs.getClub(relegated.id);

        // Find active fighters
        let pFighters = Object.values(gs.fighters).filter(f => f.club_id);
        let mvp = null;
        let rookie = null;
        let mostImproved = null;

        if (pFighters.length > 0) {
            mvp = pFighters.reduce((a, b) => ((a.dynamic_state.form || 0) + (a.dynamic_state.morale || 0)) > ((b.dynamic_state.form || 0) + (b.dynamic_state.morale || 0)) ? a : b);
            let rookies = pFighters.filter(f => f.age <= 23);
            if (rookies.length > 0) {
                rookie = rookies.reduce((a, b) => (a.dynamic_state.form || 0) > (b.dynamic_state.form || 0) ? a : b);
            }

            let validImproved = pFighters.filter(f => f.history_start_of_season_OVR !== undefined);
            if (validImproved.length > 0) {
                mostImproved = validImproved.reduce((a, b) => {
                    let aOvr = Math.floor((a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3);
                    let bOvr = Math.floor((b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3);
                    let aDiff = aOvr - a.history_start_of_season_OVR;
                    let bDiff = bOvr - b.history_start_of_season_OVR;
                    return aDiff > bDiff ? a : b;
                });
                let mOvr = Math.floor((mostImproved.core_stats.power + mostImproved.core_stats.technique + mostImproved.core_stats.speed) / 3);
                let diff = mOvr - mostImproved.history_start_of_season_OVR;
                if (diff <= 0) mostImproved = null;
            }
        }

        // Calculate Player Standing
        let playerStandingIndex = standings.findIndex(s => s.id === gs.playerClubId);
        let playerStanding = playerStandingIndex >= 0 ? standings[playerStandingIndex] : null;
        let playerRank = playerStandingIndex + 1;
        const ordinal_suffix_of = (i) => {
            let j = i % 10, k = i % 100;
            if (j == 1 && k != 11) return i + "st";
            if (j == 2 && k != 12) return i + "nd";
            if (j == 3 && k != 13) return i + "rd";
            return i + "th";
        };
        let rankStr = ordinal_suffix_of(playerRank);

        const overlay = document.createElement('div');
        overlay.id = 'global-modal-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        overlay.innerHTML = `
            <div style="background: rgba(20, 20, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-top: 4px solid #d4af37; padding: 2rem; border-radius: 12px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 30px rgba(212,175,55,0.2); text-align: center; font-family: 'Inter', sans-serif;">
                <h2 style="font-family: 'Outfit', sans-serif; color: #d4af37; font-size: 2.2rem; margin-top: 0; margin-bottom: 0.5rem; text-shadow: 0 0 10px rgba(212,175,55,0.5);">Season ${gs.season} Highlights</h2>
                <p style="color: #aaa; margin-bottom: 2rem;">The official season matches have concluded. The next two weeks are dedicated purely to offseason training and recovery.</p>

                <div style="display: flex; justify-content: space-around; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; flex: 1; min-width: 250px; border: 1px solid rgba(212,175,55,0.2);">
                        <h4 style="color: #ccc; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">👑 League Champions</h4>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #fff;">${champClub ? champClub.name : 'Unknown'}</div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">${champ.pts} Pts | ${champ.w}W - ${champ.l}L</div>
                    </div>

                    <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; flex: 1; min-width: 250px; border: 1px solid rgba(255,255,255,0.05);">
                        <h4 style="color: #ccc; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">🌟 Fighter of the Season</h4>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${mvp ? mvp.name : 'N/A'}</div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">${mvp ? (gs.getClub(mvp.club_id)?.name || '') : ''}</div>
                    </div>
                </div>

                <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid rgba(255,255,255,0.05); text-align: left;">
                    <h4 style="color: #ccc; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">📈 Your Season Result</h4>
                    <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${playerStanding ? `${playerStanding.name} finished in ${rankStr} Place` : 'Unknown'}</div>
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">${playerStanding ? `${playerStanding.pts} Points | ${playerStanding.w} Wins - ${playerStanding.l} Losses` : ''}</div>
                </div>

                <div style="display: flex; justify-content: space-around; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem;">
                    ${rookie ? `
                    <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; flex: 1; min-width: 250px; border: 1px solid rgba(255,255,255,0.05);">
                        <h4 style="color: #ccc; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">✨ Breakthrough Rookie</h4>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${rookie.name} (Age ${rookie.age})</div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">${gs.getClub(rookie.club_id)?.name || ''}</div>
                    </div>
                    ` : ''}

                    ${mostImproved ? `
                    <div style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 8px; flex: 1; min-width: 250px; border: 1px solid rgba(255,255,255,0.05);">
                        <h4 style="color: #ccc; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">🚀 Most Improved Fighter</h4>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${mostImproved.name}</div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">Massive skill jump. ${gs.getClub(mostImproved.club_id)?.name || 'Unknown'}</div>
                    </div>
                    ` : ''}
                </div>

                <div style="background: rgba(255, 51, 102, 0.1); padding: 1rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid rgba(255, 51, 102, 0.2);">
                    <h4 style="color: #ff3366; margin: 0 0 0.5rem 0; font-family: 'Outfit', sans-serif; text-transform: uppercase; font-size: 0.9rem;">🔻 At The Bottom</h4>
                    <div style="font-size: 1.1rem; font-weight: bold; color: #fff;">${relegatedClub ? relegatedClub.name : 'Unknown'}</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.85rem; margin-top: 5px;">A dismal campaign. They will need major rebuilding.</div>
                </div>

                <button style="background: #3b82f6; color: #fff; border: none; padding: 12px 35px; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1.5px; transition: filter 0.2s;" onmouseover="this.style.filter='brightness(1.2)'" onmouseout="this.style.filter='none'" onclick="window.UIComponents.closeModal()">Begin Offseason</button>
            </div>
        `;

        document.body.appendChild(overlay);
    },

    /**
     * Replaces standard alert() with a stylized HTML modal overlay
     */
    showModal(title, text, type = 'info') {
        this.closeModal(); // Ensure no duplicates

        const overlay = document.createElement('div');
        overlay.id = 'global-modal-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        let borderColor = type === 'danger' ? '#ff5252' : type === 'success' ? '#4caf50' : 'var(--accent, #3b82f6)';

        overlay.innerHTML = `
            <div style="background: rgba(20, 20, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-top: 4px solid ${borderColor}; padding: 2rem; border-radius: 12px; max-width: 550px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px ${borderColor}22; text-align: center; font-family: 'Inter', sans-serif;">
                <h2 style="font-family: 'Outfit', sans-serif; color: #fff; margin-top: 0; margin-bottom: 1rem; font-size: 1.8rem;">${title}</h2>
                <div style="color: #ccc; line-height: 1.7; font-size: 1rem; margin-bottom: 2rem;">${text}</div>
                <button id="global-modal-close" style="background: ${borderColor}; color: #fff; border: none; padding: 10px 30px; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: opacity 0.2s;" onclick="window.UIComponents.closeModal()">Acknowledge</button>
            </div>
        `;

        document.body.appendChild(overlay);
    }
};

// Accompanying tiny CSS for dynamic components:
const dynamicCSS = document.createElement('style');
dynamicCSS.textContent = `
    .fighter-card {
        padding: 1rem 1.1rem;
        border-radius: var(--radius-lg, 14px);
        background: var(--bg-panel);
        border: 1px solid var(--border-glass, rgba(255,255,255,0.07));
        transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
        margin-bottom: 0.6rem;
    }
    .fighter-card.hoverable:hover {
        transform: translateY(-2px);
        background: var(--bg-panel-hover);
        border-color: rgba(255,255,255,0.1);
    }
    .fighter-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
    .fighter-header h3 { font-family: var(--font-heading); color: #fff; font-size: 1.05rem; font-weight: 600; }
    .fighter-header .age { font-size: 0.78rem; color: var(--text-muted); }
    .fighter-tags { margin-bottom: 0.6rem; display: flex; gap: 0.35rem; flex-wrap: wrap; }
    .tag {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        border-radius: 4px;
        font-size: 0.68rem;
        font-weight: 600;
        background: rgba(255,255,255,0.06);
        color: #ccc;
        border: 1px solid rgba(255,255,255,0.04);
        letter-spacing: 0.01em;
    }
    .tag.archetype { background: var(--accent-soft, rgba(255,51,102,0.13)); color: var(--accent, #FF3366); border-color: rgba(255,51,102,0.1); }
    .tag.form { background: rgba(59,130,246,0.12); color: #60a5fa; border-color: rgba(59,130,246,0.1); }
    .fighter-metrics {
        display: flex;
        justify-content: space-between;
        background: rgba(0,0,0,0.3);
        padding: 0.6rem 0.7rem;
        border-radius: var(--radius-sm, 6px);
        gap: 0.25rem;
    }
    .metric { display: flex; flex-direction: column; align-items: center; flex: 1; }
    .metric span { font-size: 0.62rem; color: var(--text-dim, #50505e); text-transform: uppercase; margin-bottom: 0.15rem; letter-spacing: 0.04em; }
    .metric strong { color: #fff; font-family: var(--font-heading); font-size: 0.88rem; }
    .fighter-portrait-sm {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: var(--radius-sm, 6px);
        border: 2px solid rgba(255,255,255,0.1);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        flex-shrink: 0;
    }
`;
document.head.appendChild(dynamicCSS);