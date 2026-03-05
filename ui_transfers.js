/**
 * ui_transfers.js  — Football Manager-style Transfer Module
 *
 * Tab 1: 📥 Transfer Inbox  — review incoming bids, accept/reject/counter
 * Tab 2: 👊 My Roster       — willingness badges, list/release, demands
 * Tab 3: 🆓 Free Agents     — scout & bid on uncontracted fighters
 * Tab 4: 🌍 Transfers     — Bosman targets + contracted buyouts
 */

window.UITransfers = {

    // ─── MAIN RENDER ───────────────────────────────────────────────────────────

    render(container, params) {
        const gs = window.GameState;
        if (!gs.transferInbox) gs.transferInbox = [];
        if (!gs.pendingTransferDemands) gs.pendingTransferDemands = [];

        // Track active tab for sort state
        const activeTab = params?.tab || 'scout';
        this._activeTab = activeTab;

        // --- Save-game cleanup: clean up invalid listings ---
        // Also aggressively cap the list to prevent old-save bloat
        if (gs.listedForTransfer) {
            gs.listedForTransfer = gs.listedForTransfer.filter(l => {
                const f = gs.getFighter(l.fighterId);
                if (!f) return false; // Fighter doesn't exist, prune

                // Free agents cannot be on the global transfer list. They belong in Free Agency.
                if (!f.club_id) { f.transfer_listed = false; return false; }

                return true;
            });
            // If the list is insanely long from an old save, cap it at 12 entries (keep newest)
            if (gs.listedForTransfer.length > 12) {
                const pruned = gs.listedForTransfer.slice(-12);
                // Clear transfer_listed flag on the pruned ones
                gs.listedForTransfer.slice(0, gs.listedForTransfer.length - 12).forEach(l => {
                    const f = gs.getFighter(l.fighterId);
                    if (f) f.transfer_listed = false;
                });
                gs.listedForTransfer = pruned;
            }
        }
        // Fix transferInbox: only keep bids WHERE the fighter is owned by the player club (i.e. player listed them)
        if (gs.transferInbox) {
            gs.transferInbox = gs.transferInbox.filter(b => {
                const f = gs.getFighter(b.fighterId);
                return f && f.club_id === gs.playerClubId;
            });
        }

        // --- One-time morale stabilization for old saves ---
        // Prevents fighters from being chronically unhappy, which causes mass transfer listings.
        if (!gs._moraleStabilized) {
            Object.values(gs.fighters || {}).forEach(f => {
                if (!f.club_id || !f.dynamic_state || !f.contract) return;
                // Critically low morale + ok contract: gentle bump
                if (f.dynamic_state.morale < 35 && f.contract.happiness >= 40) {
                    f.dynamic_state.morale = 45;
                }
                // Both critically low: reset both and clear the transfer demand
                if (f.dynamic_state.morale < 20 && f.contract.happiness < 25) {
                    f.dynamic_state.morale = 35;
                    f.contract.happiness = 40;
                    f.contract.demand_triggered = false;
                    f.transfer_listed = false;
                }
            });
            // Remove demands that no longer qualify after the fix
            if (gs.pendingTransferDemands) {
                gs.pendingTransferDemands = gs.pendingTransferDemands.filter(d => {
                    const f = gs.getFighter(d.fighterId);
                    return f && f.dynamic_state && f.dynamic_state.morale < 40;
                });
            }
            gs._moraleStabilized = true;
        }

        const inboxCount = gs.transferInbox.length;
        const demandCount = (gs.pendingTransferDemands || []).length;

        // Use initial activeTab value from params (already set at start of render)

        container.innerHTML = `
            ${window.UIComponents.createSectionHeader('Transfers', 'Football Manager-style transfer centre. Review offers, manage your roster.')}

            <div class="glass-panel" style="padding: 1rem; margin-bottom: 1.5rem; display:flex; justify-content:space-between; align-items:center;">
                <span>Budget: <strong style="color:#00e676;">$${gs.money.toLocaleString()}</strong></span>
                <span>Action Points: <strong style="color:var(--accent);">${gs.actionPoints} / ${gs.maxActionPoints}</strong></span>
                <span style="font-size:0.85rem; color:var(--text-muted);">Week ${gs.week}</span>
            </div>

            <!-- TABS -->
            <div style="display:flex; gap:0.5rem; margin-bottom:1.5rem; flex-wrap:wrap;">
                ${this._tab('inbox', `📥 Inbox${inboxCount > 0 ? ` <span style="background:#ff5252;color:#fff;border-radius:50%;padding:1px 6px;font-size:0.75rem;">${inboxCount}</span>` : ''}`, activeTab)}
                ${this._tab('roster', `👊 My Roster${demandCount > 0 ? ` <span style="background:#ff9800;color:#000;border-radius:50%;padding:1px 6px;font-size:0.75rem;">!</span>` : ''}`, activeTab)}
                ${this._tab('free', '🆓 Free Agents', activeTab)}
                ${this._tab('scout', '🌍 Transfers', activeTab)}
            </div>

            <div id="transfers-content"></div>
        `;

        container.querySelectorAll('.xfer-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                window.Router.loadRoute('transfers', { tab: btn.dataset.tab });
            });
        });

        const content = document.getElementById('transfers-content');
        if (activeTab === 'inbox') this._renderInbox(content);
        if (activeTab === 'roster') this._renderRoster(content);

        if (activeTab === 'free') {
            this._renderFreeAgents(content);
            if (params && params.targetId) {
                setTimeout(() => {
                    const f = gs.getFighter(params.targetId) || gs.transferPool.find(pf => pf.id === params.targetId);
                    if (f) {
                        if (!f.scouted) {
                            this.scoutFighter(f.id, null);
                        } else {
                            this.initiateBid(f.id);
                        }
                    }
                }, 100);
            }
        }

        if (activeTab === 'scout') {
            this._renderScouting(content);
            if (params && params.targetId) {
                setTimeout(() => {
                    const f = gs.getFighter(params.targetId);
                    if (f) {
                        if (!f.scouted) {
                            this.scoutFighter(f.id, null);
                        } else if (f.contract && f.contract.seasons_remaining === 1) {
                            this.initiateBosman(f.id);
                        } else {
                            this.initiatePoach(f.id);
                        }
                    }
                }, 100);
            }
        }
    },

    _tab(id, label, active) {
        const isActive = id === active;
        return `<button class="xfer-tab btn-primary" data-tab="${id}" style="padding:0.6rem 1.2rem; font-size:0.9rem; ${isActive ? 'background:var(--accent);' : 'background:rgba(255,255,255,0.1);'}">${label}</button>`;
    },

    _sortState: { column: null, desc: false },
    _activeTab: 'scout',
    _setSort(col) {
        if (this._sortState.column === col) {
            this._sortState.desc = !this._sortState.desc;
        } else {
            this._sortState.column = col;
            this._sortState.desc = true;
        }
        // Re-render the same tab without navigating away
        window.Router.loadRoute('transfers', { tab: this._activeTab });
    },
    _getSortIndicator(col) {
        if (this._sortState.column !== col) return '';
        return this._sortState.desc ? ' ▾' : ' ▴';
    },
    _sortFighters(list, defaultDesc = true) {
        if (!this._sortState.column) return list;
        return list.sort((a, b) => {
            let valA, valB;
            switch (this._sortState.column) {
                case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                case 'age': valA = a.age || 0; valB = b.age || 0; break;
                case 'ovr': valA = (a.core_stats.power + a.core_stats.technique + a.core_stats.speed) / 3; valB = (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) / 3; break;
                case 'style': valA = this._getBestStyle(a); valB = this._getBestStyle(b); break;
                case 'price':
                    valA = a.contract?.release_clause || window.ContractEngine.getPerceivedWorth(a) * 1.5;
                    valB = b.contract?.release_clause || window.ContractEngine.getPerceivedWorth(b) * 1.5;
                    break;
                case 'salary':
                    valA = window.ContractEngine.getPerceivedWorth(a);
                    valB = window.ContractEngine.getPerceivedWorth(b);
                    break;
                case 'asking':
                    valA = window.GameState.listedForTransfer?.find(l => l.fighterId === a.id)?.askingFee || 0;
                    valB = window.GameState.listedForTransfer?.find(l => l.fighterId === b.id)?.askingFee || 0;
                    break;
                default: return 0;
            }
            if (valA < valB) return this._sortState.desc ? 1 : -1;
            if (valA > valB) return this._sortState.desc ? -1 : 1;
            return 0;
        });
    },
    _getBestStyle(f) {
        if (!f.style_affinities) return '';
        let best = '';
        let max = -1;
        for (let s in f.style_affinities) {
            if (f.style_affinities[s] > max) { max = f.style_affinities[s]; best = s; }
        }
        return best.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    // ─── TAB 1: TRANSFER INBOX ─────────────────────────────────────────────────

    _renderInbox(container) {
        const gs = window.GameState;
        let inbox = gs.transferInbox || [];

        // Filter to only show bids for fighters currently owned by the player
        inbox = inbox.filter(bid => {
            let f = gs.getFighter(bid.fighterId);
            return f && f.club_id === gs.playerClubId;
        });

        // Also show pending demands
        const demands = gs.pendingTransferDemands || [];

        if (inbox.length === 0 && demands.length === 0) {
            container.innerHTML = `
                <div class="glass-panel" style="padding:2rem; text-align:center; color:var(--text-muted);">
                    <div style="font-size:3rem; margin-bottom:1rem;">📭</div>
                    <h3>No Incoming Offers</h3>
                    <p style="margin-top:0.5rem;">List fighters for transfer in the <strong>My Roster</strong> tab — AI clubs will bid within a week.</p>
                </div>`;
            return;
        }

        let html = '';

        // Demand notifications first
        demands.forEach(demand => {
            const f = gs.getFighter(demand.fighterId);
            if (!f) return;
            const imgSrc = f.avatar ? `assets/portraits/${f.avatar}` : `assets/portraits/${f.name.toLowerCase()}.png`;
            const fallback = window.UIComponents._makeInitialsAvatar(f.name, '#ff5252');
            html += `
                <div class="glass-panel" style="padding:1.5rem; margin-bottom:1rem; border-left:4px solid #ff9800; display:flex; gap:1rem; align-items:center; flex-wrap:wrap;">
                    <img src="${imgSrc}" onerror="this.src='${fallback}'" style="width:60px;height:60px;border-radius:8px;object-fit:cover;border:2px solid #ff9800;" />
                    <div style="flex:1; min-width:220px;">
                        <div style="color:#ff9800; font-weight:bold; font-size:0.85rem; text-transform:uppercase; margin-bottom:0.3rem;">⚠️ Transfer Request</div>
                        <h3 style="margin:0 0 0.3rem;">${f.name}</h3>
                        <p style="font-size:0.85rem; color:var(--text-muted);">She is desperate to leave. ${demand.willingness.reasons.join(' · ')}</p>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button class="btn-primary" style="background:#e0a020; padding:0.5rem 1rem;" onclick="window.UITransfers.listFromDemand('${f.id}')">List for Transfer</button>
                        <button class="btn-primary" style="background:#555; padding:0.5rem 1rem;" onclick="window.UITransfers.rejectDemand('${f.id}')">Reject Demand (−15 Morale)</button>
                    </div>
                </div>`;
        });

        // Bid cards
        if (inbox.length > 0) {
            html += `<h3 style="margin-bottom:1rem; font-family:var(--font-heading); color:var(--accent);">Incoming Transfer Bids</h3>`;
        }
        inbox.forEach(bid => {
            const f = gs.getFighter(bid.fighterId);
            const club = gs.getClub(bid.biddingClubId);
            if (!f || !club) return;

            const w = window.AITransfers._computeFighterWillingness(f);
            const wBadge = this._willingnessBadge(w.level);
            const imgSrc = f.avatar ? `assets/portraits/${f.avatar}` : `assets/portraits/${f.name.toLowerCase()}.png`;
            const fallback = window.UIComponents._makeInitialsAvatar(f.name, '#888');

            // Detect lovers in squad
            const playerClub = gs.getClub(gs.playerClubId);
            let loverNote = '';
            if (playerClub) {
                playerClub.fighter_ids.forEach(id => {
                    if (id === f.id) return;
                    if (window.RelationshipEngine) {
                        const rel = window.RelationshipEngine.getRelationship(f.id, id);
                        if (rel && (rel.type === 'lovers' || rel.type === 'obsession' || rel.type === 'committed')) {
                            const partner = gs.getFighter(id);
                            if (partner) loverNote = `💔 Selling her will devastate her lover <strong>${partner.name}</strong> (−30 Morale, −30 Stress)`;
                        }
                    }
                });
            }

            // Fighter reaction text
            let reaction = '';
            if (w.level === 'wants_out') reaction = `<em>"I need to move on. This is the right opportunity."</em>`;
            else if (w.level === 'restless') reaction = `<em>"I'm open to listening… but I'm not sure I want to leave."</em>`;
            else if (w.level === 'neutral') reaction = `<em>"I have no strong feelings either way."</em>`;
            else reaction = `<em>"I don't want to go. This club is my home."</em>`;

            const overBid = bid.offerAmount >= bid.askingFee;
            const bidColor = overBid ? '#00e676' : '#ffca28';

            html += `
                <div class="glass-panel" style="padding:1.5rem; margin-bottom:1rem; border-left:4px solid ${club.color};">
                    <div style="display:flex; gap:1.2rem; align-items:flex-start; flex-wrap:wrap;">
                        <img src="${imgSrc}" onerror="this.src='${fallback}'" style="width:70px;height:70px;border-radius:10px;object-fit:cover;border:2px solid ${club.color};" />
                        <div style="flex:1; min-width:200px;">
                            <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.3rem;">
                                <h3 style="margin:0;">${f.name}</h3>
                                ${wBadge}
                            </div>
                            <div style="font-size:0.85rem; color:${club.color}; margin-bottom:0.4rem; font-weight:bold;">${club.name} — Week ${bid.weekReceived}</div>
                            <div style="font-size:0.9rem; color:var(--text-muted); margin-bottom:0.5rem;">${reaction}</div>
                            ${loverNote ? `<div style="font-size:0.8rem; color:#ff9800; margin-bottom:0.5rem;">${loverNote}</div>` : ''}
                            <div style="font-size:0.85rem; color:var(--text-muted);">Fighter reasons: ${w.reasons.join(' · ') || 'None'}</div>
                        </div>
                        <div style="text-align:right; min-width:150px;">
                            <div style="font-size:1.8rem; font-weight:bold; color:${bidColor};">$${bid.offerAmount.toLocaleString()}</div>
                            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1rem;">Asking: $${bid.askingFee.toLocaleString()}</div>
                            <div style="display:flex; flex-direction:column; gap:0.4rem;">
                                <button class="btn-primary" style="background:#00e676;color:#000;padding:0.5rem 1rem;" onclick="window.UITransfers.acceptBid('${bid.id}')">✅ Accept</button>
                                <button class="btn-primary" style="background:#333;padding:0.5rem 1rem;" onclick="window.UITransfers.counterBid('${bid.id}')">💬 Counter</button>
                                <button class="btn-primary" style="background:#e0284f;padding:0.5rem 1rem;" onclick="window.UITransfers.rejectBid('${bid.id}')">❌ Reject</button>
                            </div>
                        </div>
                    </div>
                </div>`;
        });

        container.innerHTML = html;
    },

    // ─── TAB 2: MY ROSTER ──────────────────────────────────────────────────────

    _renderRoster(container) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (!club) { container.innerHTML = '<p>No club data.</p>'; return; }

        let html = `
            <p class="text-muted" style="font-size:0.85rem; margin-bottom:1rem;">
                <strong>List for Transfer:</strong> AI clubs bid next week — offers appear in your Inbox.<br>
                <strong>Release:</strong> Pay severance to immediately release her to free agency.
            </p>
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="text-align:left; border-bottom:1px solid var(--border-glass);">
                        <th style="padding:0.8rem;">Fighter</th>
                        <th style="padding:0.8rem;">OVR</th>
                        <th style="padding:0.8rem;">Contract</th>
                        <th style="padding:0.8rem;">Willingness</th>
                        <th style="padding:0.8rem;">Status</th>
                        <th style="padding:0.8rem;">Action</th>
                    </tr>
                </thead>
                <tbody>`;

        club.fighter_ids.forEach(fId => {
            const f = gs.getFighter(fId);
            if (!f) return;

            const cs = f.core_stats;
            const ovr = Math.round((cs.power + cs.technique + cs.speed) / 3);
            const seasons = f.contract ? f.contract.seasons_remaining : '?';
            const salary = f.contract ? `$${f.contract.salary.toLocaleString()}/yr` : 'N/A';

            const w = window.AITransfers._computeFighterWillingness(f);
            const wBadge = this._willingnessBadge(w.level, w.reasons);

            const isListed = gs.listedForTransfer && gs.listedForTransfer.find(l => l.fighterId === fId);
            const isDemanding = f.contract && f.contract.demand_triggered;
            let statusHtml = isListed
                ? `<span style="color:#d4af37; font-size:0.8rem;">📋 Listed</span>`
                : isDemanding
                    ? `<span style="color:#ff9800; font-size:0.8rem;">⚠️ Demanding Transfer</span>`
                    : `<span style="color:var(--text-muted); font-size:0.8rem;">—</span>`;

            let actionHtml = '';
            if (club.fighter_ids.length <= 1) {
                actionHtml = `<span style="color:var(--text-muted); font-size:0.8rem;">Last fighter</span>`;
            } else if (isListed) {
                actionHtml = `<button class="btn-primary" style="padding:0.35rem 0.7rem;font-size:0.8rem;background:#555;" onclick="window.UITransfers.cancelListing('${f.id}')">Cancel</button>`;
            } else {
                const isRookieAcademy = f.traits?.includes('academy_product') && f.age <= 21;
                const sev = (isRookieAcademy || !f.contract) ? 0 : (f.contract.salary * (f.contract.seasons_remaining || 1));
                const btnText = sev === 0 ? "Release (Free)" : `Release ($${sev.toLocaleString()})`;
                actionHtml = `
                    <button class="btn-primary" style="padding:0.35rem 0.7rem;font-size:0.8rem;background:#e0a020;margin-right:4px;" onclick="window.UITransfers.listForTransfer('${f.id}')">List</button>
                    <button class="btn-primary" style="padding:0.35rem 0.7rem;font-size:0.8rem;background:#e0284f;" onclick="window.UITransfers.releaseAsFreeAgent('${f.id}')">${btnText}</button>`;
            }

            html += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.9rem;"><strong>${f.name}</strong></td>
                    <td style="padding:0.9rem;"><strong style="color:var(--accent);">${ovr}</strong></td>
                    <td style="padding:0.9rem; font-size:0.85rem;">${salary} · ${seasons} season(s)</td>
                    <td style="padding:0.9rem;">${wBadge}</td>
                    <td style="padding:0.9rem;">${statusHtml}</td>
                    <td style="padding:0.9rem;">${actionHtml}</td>
                </tr>`;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    // ─── TAB 3: FREE AGENTS ────────────────────────────────────────────────────

    _renderFreeAgents(container) {
        const gs = window.GameState;

        // If transferPool is empty (can happen with loaded saves mid-season),
        // rebuild it from fighters who have no club assignment.
        if (gs.transferPool.length === 0) {
            Object.values(gs.fighters || {}).forEach(f => {
                if (!f.club_id && !f.retired && !f.transfer_listed) {
                    // Check they're not already in the pool
                    if (!gs.transferPool.find(p => p.id === f.id)) {
                        gs.transferPool.push(f);
                    }
                }
            });
        }

        if (gs.transferPool.length === 0) {
            container.innerHTML = `<div class="glass-panel" style="padding:2rem;text-align:center;color:var(--text-muted);">No free agents available. Check back next season.</div>`;
            return;
        }

        let html = `
            <p class="text-muted" style="font-size:0.85rem; margin-bottom:1rem;">Scout first to reveal true stats, then make a salary bid.</p>
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="text-align:left; border-bottom:1px solid var(--border-glass);">
                        <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('name')">Name${this._getSortIndicator('name')}</th>
                        <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('age')">Age${this._getSortIndicator('age')}</th>
                        <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('ovr')">OVR Est.${this._getSortIndicator('ovr')}</th>
                        <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('style')">Best Style${this._getSortIndicator('style')}</th>
                        <th style="padding:0.8rem;">Action</th>
                    </tr>
                </thead>
                <tbody>`;

        let sortedPool = this._sortFighters([...gs.transferPool], true);

        sortedPool.forEach((f) => {
            const cs = f.core_stats;
            const rawOvr = Math.floor((cs.power + cs.technique + cs.speed) / 3);
            const styleDisplay = f.scouted
                ? `<span style="color:#28a0e0;">${this._getBestStyle(f)}</span>`
                : `<span class="text-muted">?</span>`;

            const btnAction = f.scouted
                ? `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:var(--accent);" onclick="window.UITransfers.initiateBid('${f.id}')">Make Bid</button>`
                : `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#555;" onclick="window.UITransfers.scoutFighter('${f.id}',null)">Scout (1 AP)</button>`;

            html += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.9rem;"><strong>${f.name}</strong></td>
                    <td style="padding:0.9rem;">${f.age}</td>
                    <td style="padding:0.9rem;">${f.scouted ? `<strong style="color:var(--accent);">${rawOvr}</strong>` : `<span class="text-muted">~${rawOvr + Math.floor(Math.random() * 6) - 3}</span>`}</td>
                    <td style="padding:0.9rem; font-size:0.85rem;">${styleDisplay}</td>
                    <td style="padding:0.9rem;">${btnAction}</td>
                </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    // ─── TAB 4: SCOUTING ───────────────────────────────────────────────────────

    _renderScouting(container) {
        const gs = window.GameState;
        if (!gs._globalTargetsCache) this._rebuildGlobalTargetsCache();

        const bosman = this._getBosmanTargets();

        let listed = (gs.listedForTransfer || []).filter(l => {
            const f = gs.getFighter(l.fighterId);
            return f && f.club_id !== gs.playerClubId;
        });
        const listedIds = listed.map(l => l.fighterId);

        const contracted = gs._globalTargetsCache.filter(f =>
            f.contract &&
            f.contract.seasons_remaining !== 1 &&
            !listedIds.includes(f.id)
        );

        let html = `
            <h3 style="margin-bottom:0.5rem; color:#ff80ab;">🔓 Bosman Targets — Final Contract Year (Free Next Season)</h3>
            <p class="text-muted" style="font-size:0.85rem; margin-bottom:1rem;">No transfer fee — agree salary now, she joins at season start.</p>`;

        if (bosman.length === 0) {
            html += `<p class="text-muted" style="margin-bottom:2rem;">None available right now.</p>`;
        } else {
            html += `<table style="width:100%; border-collapse:collapse; margin-bottom:2rem;"><thead><tr style="text-align:left; border-bottom:1px solid var(--border-glass);">
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('name')">Name (Club)${this._getSortIndicator('name')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('age')">Age${this._getSortIndicator('age')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('ovr')">OVR${this._getSortIndicator('ovr')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('style')">Best Style${this._getSortIndicator('style')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('salary')">Min Salary${this._getSortIndicator('salary')}</th>
                <th style="padding:0.8rem;">Action</th>
            </tr></thead><tbody>`;
            this._sortFighters(bosman, true).forEach(f => {
                const ovr = Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                const ownerClub = gs.getClub(f.club_id);
                const minSalary = Math.floor(ovr * 180 + 10000);
                const pending = gs.pendingBosmanMoves && gs.pendingBosmanMoves.find(b => b.fighterId === f.id);
                const statD = f.scouted ? `<strong style="color:var(--accent);">${ovr}</strong>` : `<span class="text-muted">~${ovr + Math.floor(Math.random() * 8) - 4}</span>`;
                const actionHtml = pending
                    ? `<span style="color:#00e676; font-size:0.85rem;">✅ Agreed @ $${pending.salary.toLocaleString()}/yr</span>`
                    : f.scouted
                        ? `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#28a0e0;" onclick="window.UITransfers.initiateBosman('${f.id}')">Pre-Sign</button>`
                        : `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#555;" onclick="window.UITransfers.scoutFighter('${f.id}',null)">Scout (1 AP)</button>`;
                const styleDisplay = f.scouted
                    ? `<span style="color:#28a0e0;">${this._getBestStyle(f)}</span>`
                    : `<span class="text-muted">?</span>`;

                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.9rem;"><strong>${f.name}</strong><br><span style="font-size:0.8rem;color:${ownerClub?.color || '#aaa'};">${ownerClub?.name || 'Unknown'}</span></td>
                    <td style="padding:0.9rem;">${f.age}</td>
                    <td style="padding:0.9rem;">${statD}</td>
                    <td style="padding:0.9rem; font-size:0.85rem;">${styleDisplay}</td>
                    <td style="padding:0.9rem;">$${minSalary.toLocaleString()}/yr</td>
                    <td style="padding:0.9rem;">${actionHtml}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }

        // 'listed' was already computed above to filter out player's own club
        html += `<h3 style="margin-bottom:0.5rem; color:#ff9800;">📉 Transfer Listed (Bargains)</h3>
                 <p class="text-muted" style="font-size:0.85rem; margin-bottom:1rem;">Buyout fees slashed by their clubs.</p>`;

        if (listed.length === 0) {
            html += `<p class="text-muted" style="margin-bottom:2rem;">No fighters currently transfer listed.</p>`;
        } else {
            let listedFighters = listed.map(l => gs.getFighter(l.fighterId)).filter(Boolean);
            html += `<table style="width:100%; border-collapse:collapse; margin-bottom:2rem;"><thead><tr style="text-align:left; border-bottom:1px solid var(--border-glass);">
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('name')">Name (Club)${this._getSortIndicator('name')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('age')">Age${this._getSortIndicator('age')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('ovr')">OVR${this._getSortIndicator('ovr')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('style')">Best Style${this._getSortIndicator('style')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('asking')">Asking Fee${this._getSortIndicator('asking')}</th>
                <th style="padding:0.8rem;">Action</th>
            </tr></thead><tbody>`;
            this._sortFighters(listedFighters, true).forEach(f => {
                const l = listed.find(item => item.fighterId === f.id);
                const ovr = Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                const ownerClub = gs.getClub(f.club_id);
                const statD = f.scouted ? `<strong style="color:var(--accent);">${ovr}</strong>` : `<span class="text-muted">~${ovr + Math.floor(Math.random() * 8) - 4}</span>`;
                const actionHtml = f.scouted
                    ? `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#ff9800;" onclick="window.UITransfers.initiatePoach('${f.id}')">Negotiate Buyout</button>`
                    : `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#555;" onclick="window.UITransfers.scoutFighter('${f.id}',null)">Scout (1 AP)</button>`;
                const styleDisplay = f.scouted
                    ? `<span style="color:#28a0e0;">${this._getBestStyle(f)}</span>`
                    : `<span class="text-muted">?</span>`;

                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.9rem;"><strong>${f.name}</strong><br><span style="font-size:0.8rem;color:${ownerClub?.color || '#aaa'};">${ownerClub?.name || 'Unknown'}</span></td>
                    <td style="padding:0.9rem;">${f.age}</td>
                    <td style="padding:0.9rem;">${statD}</td>
                    <td style="padding:0.9rem; font-size:0.85rem;">${styleDisplay}</td>
                    <td style="padding:0.9rem; color:#ff9800;">$${l.askingFee.toLocaleString()}</td>
                    <td style="padding:0.9rem;">${actionHtml}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }

        html += `<h3 style="margin-bottom:0.5rem; color:var(--accent);">🌍 Contracted Targets (Buyout Required)</h3>`;
        if (contracted.length === 0) {
            html += `<p class="text-muted">No contracted fighters available for buyout.</p>`;
        } else {
            html += `<table style="width:100%; border-collapse:collapse;"><thead><tr style="text-align:left; border-bottom:1px solid var(--border-glass);">
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('name')">Name (Club)${this._getSortIndicator('name')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('age')">Age${this._getSortIndicator('age')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('ovr')">OVR${this._getSortIndicator('ovr')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('style')">Best Style${this._getSortIndicator('style')}</th>
                <th style="padding:0.8rem; cursor:pointer;" onclick="window.UITransfers._setSort('price')">Est. Buyout${this._getSortIndicator('price')}</th>
                <th style="padding:0.8rem;">Action</th>
            </tr></thead><tbody>`;
            this._sortFighters(contracted, true).forEach(f => {
                const ovr = Math.round((f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3);
                const ownerClub = gs.getClub(f.club_id);
                const buyout = Math.floor(ovr * 1200);
                const statD = f.scouted ? `<strong style="color:var(--accent);">${ovr}</strong>` : `<span class="text-muted">~${ovr + Math.floor(Math.random() * 8) - 4}</span>`;
                const actionHtml = f.scouted
                    ? `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#e0284f;" onclick="window.UITransfers.initiatePoach('${f.id}')">Negotiate Buyout</button>`
                    : `<button class="btn-primary" style="padding:0.35rem 0.8rem;font-size:0.8rem;background:#555;" onclick="window.UITransfers.scoutFighter('${f.id}',null)">Scout (1 AP)</button>`;
                const styleDisplay = f.scouted
                    ? `<span style="color:#28a0e0;">${this._getBestStyle(f)}</span>`
                    : `<span class="text-muted">?</span>`;

                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.9rem;"><strong>${f.name}</strong><br><span style="font-size:0.8rem;color:${ownerClub?.color || '#aaa'};">${ownerClub?.name || 'Unknown'}</span></td>
                    <td style="padding:0.9rem;">${f.age}</td>
                    <td style="padding:0.9rem;">${statD}</td>
                    <td style="padding:0.9rem; font-size:0.85rem;">${styleDisplay}</td>
                    <td style="padding:0.9rem;">~$${buyout.toLocaleString()}</td>
                    <td style="padding:0.9rem;">${actionHtml}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }

        container.innerHTML = html;
    },

    // ─── WILLINGNESS BADGE ─────────────────────────────────────────────────────

    _willingnessBadge(level, reasons) {
        const map = {
            'wants_out': { emoji: '🔴', label: 'Wants Out', color: '#ff5252' },
            'restless': { emoji: '🟠', label: 'Restless', color: '#ff9800' },
            'neutral': { emoji: '🟡', label: 'Neutral', color: '#ffea00' },
            'settled': { emoji: '🟢', label: 'Settled', color: '#00e676' }
        };
        const d = map[level] || map['neutral'];
        const tip = reasons && reasons.length ? reasons.join(', ') : '';
        return `<span title="${tip}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;background:${d.color}22;border:1px solid ${d.color};font-size:0.78rem;color:${d.color};font-weight:bold;cursor:help;">${d.emoji} ${d.label}</span>`;
    },

    // ─── BID ACTIONS ───────────────────────────────────────────────────────────

    acceptBid(bidId) {
        const gs = window.GameState;
        const bid = gs.transferInbox.find(b => b.id === bidId);
        if (!bid) return;

        const fighter = gs.getFighter(bid.fighterId);
        const buyingClub = gs.getClub(bid.biddingClubId);
        const playerClub = gs.getClub(gs.playerClubId);
        if (!fighter || !buyingClub || !playerClub) return;

        const w = window.AITransfers._computeFighterWillingness(fighter);

        // ── Check for lovers ──
        let loverConsequences = [];
        const partnerId = fighter.dynamic_state?.primary_partner_id;
        if (partnerId && playerClub.fighter_ids.includes(partnerId)) {
            const partner = gs.getFighter(partnerId);
            if (partner) {
                loverConsequences.push(`💔 <strong>${partner.name}</strong> was her partner. This transfer will cause major emotional fallout.`);
            }
        }

        // ── Squad morale impact ──
        let squadNote = '';
        if (w.level === 'settled') {
            playerClub.fighter_ids.filter(id => id !== fighter.id).forEach(id => {
                const m = gs.getFighter(id);
                if (m) m.dynamic_state.morale = Math.max(0, (m.dynamic_state.morale || 50) - 10);
            });
            squadNote = 'Squad morale −10 (settled player sold against her wishes).';
        } else if (w.level === 'wants_out') {
            playerClub.fighter_ids.filter(id => id !== fighter.id).forEach(id => {
                const m = gs.getFighter(id);
                if (m) m.dynamic_state.morale = Math.min(100, (m.dynamic_state.morale || 50) + 5);
            });
            squadNote = 'Squad morale +5 (disruptive player gone).';
        }

        // ── Execute sale ──
        gs.money += bid.offerAmount;
        playerClub.fighter_ids = playerClub.fighter_ids.filter(id => id !== fighter.id);
        fighter.club_id = buyingClub.id;
        fighter.transfer_listed = false;

        const ovr = Math.round((fighter.core_stats.power + fighter.core_stats.technique + fighter.core_stats.speed) / 3);
        const newSalary = Math.floor(ovr * 150 + 10000);
        fighter.contract = { salary: newSalary, seasons_remaining: 3, win_bonus: Math.floor(newSalary * 0.1), release_clause: newSalary * 10, happiness: w.level === 'wants_out' ? 90 : 55, demand_triggered: false };
        buyingClub.fighter_ids.push(fighter.id);
        buyingClub.money = (buyingClub.money || 100000) - bid.offerAmount;

        // Clear all bids for this fighter and from transfer list
        gs.transferInbox = gs.transferInbox.filter(b => b.fighterId !== fighter.id);
        if (gs.listedForTransfer) gs.listedForTransfer = gs.listedForTransfer.filter(l => l.fighterId !== fighter.id);

        gs.addNews('transfer', `TRANSFER: ${buyingClub.name} signed ${fighter.name} from ${playerClub.name} for $${bid.offerAmount.toLocaleString()}!`);

        if (window.RelationshipEngine) {
            window.RelationshipEngine.evaluateTransferFallout(fighter.id);
        }

        // ── Show consequence summary ──
        let resultMsg = `✅ <strong>${fighter.name}</strong> sold to ${buyingClub.name} for <strong style="color:#00e676;">$${bid.offerAmount.toLocaleString()}</strong>.<br><br>`;
        if (loverConsequences.length) resultMsg += loverConsequences.join('<br>') + '<br><br>';
        if (squadNote) resultMsg += `<em>${squadNote}</em>`;

        if (window.UIComponents && window.UIComponents.showModal) window.UIComponents.showModal('Transfer Complete', resultMsg, 'success');
        if (typeof updateNavUI === 'function') updateNavUI();
        window.Router.loadRoute('transfers', { tab: 'inbox' });
    },

    rejectBid(bidId) {
        const gs = window.GameState;
        const bid = gs.transferInbox.find(b => b.id === bidId);
        if (!bid) return;
        const f = gs.getFighter(bid.fighterId);
        const club = gs.getClub(bid.biddingClubId);
        const w = f ? window.AITransfers._computeFighterWillingness(f) : null;

        // If fighter wanted out, she gets upset at rejection
        if (f && w && w.level === 'wants_out') {
            f.dynamic_state.morale = Math.max(0, (f.dynamic_state.morale || 50) - 15);
            f.dynamic_state.stress = Math.min(100, (f.dynamic_state.stress || 0) + 10);
            gs.addNews('transfer', `${f?.name} is furious after ${club?.name}'s bid was rejected.`);
        }

        gs.transferInbox = gs.transferInbox.filter(b => b.id !== bidId);
        if (f && club) gs.addNews('transfer', `${club.name}'s bid for ${f.name} was declined.`);
        window.Router.loadRoute('transfers', { tab: 'inbox' });
    },

    counterBid(bidId) {
        const gs = window.GameState;
        const bid = gs.transferInbox.find(b => b.id === bidId);
        if (!bid) return;
        const f = gs.getFighter(bid.fighterId);
        const club = gs.getClub(bid.biddingClubId);
        if (!f || !club) return;

        const counterStr = prompt(`Counter-offer to ${club.name} for ${f.name}.\n\nTheir bid: $${bid.offerAmount.toLocaleString()}\nYour asking: $${bid.askingFee.toLocaleString()}\n\nEnter your counter-offer:`, bid.askingFee.toString());
        if (!counterStr) return;
        const counter = parseInt(counterStr.replace(/,/g, ''));
        if (isNaN(counter) || counter <= 0) { alert('Invalid amount.'); return; }

        // AI accepts if counter is within 15% of their original bid; else they walk
        const aiMax = Math.floor(bid.offerAmount * 1.15);
        if (counter <= aiMax) {
            bid.offerAmount = counter;
            bid.askingFee = counter;
            gs.addNews('transfer', `${club.name} accepted the counter-offer of $${counter.toLocaleString()} for ${f.name}.`);
            alert(`${club.name} accepted your counter-offer of $${counter.toLocaleString()}! Review and Accept in the Inbox.`);
        } else {
            gs.transferInbox = gs.transferInbox.filter(b => b.id !== bidId);
            gs.addNews('transfer', `${club.name} withdrew their bid for ${f.name} after the counter-offer was too high.`);
            alert(`${club.name} walked away from negotiations.`);
        }
        window.Router.loadRoute('transfers', { tab: 'inbox' });
    },

    // ─── DEMAND ACTIONS ────────────────────────────────────────────────────────

    listFromDemand(fighterId) {
        const gs = window.GameState;
        gs.pendingTransferDemands = (gs.pendingTransferDemands || []).filter(d => d.fighterId !== fighterId);
        this.listForTransfer(fighterId);
    },

    rejectDemand(fighterId) {
        const gs = window.GameState;
        const f = gs.getFighter(fighterId);
        if (!f) return;
        f.dynamic_state.morale = Math.max(0, (f.dynamic_state.morale || 50) - 15);
        f.dynamic_state.stress = Math.min(100, (f.dynamic_state.stress || 0) + 10);
        gs.pendingTransferDemands = (gs.pendingTransferDemands || []).filter(d => d.fighterId !== fighterId);
        gs.addNews('transfer', `${f.name}'s transfer request was rejected. She'll be sulking.`);
        window.Router.loadRoute('transfers', { tab: 'inbox' });
    },

    // ─── LIST / RELEASE ────────────────────────────────────────────────────────

    listForTransfer(fighterId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        const fighter = gs.getFighter(fighterId);
        if (!fighter || !fighter.contract) { alert('Invalid fighter data.'); return; }
        if (club.fighter_ids.length <= 1) { alert('Cannot list your last fighter!'); return; }

        const ovr = Math.round((fighter.core_stats.power + fighter.core_stats.technique + fighter.core_stats.speed) / 3);
        const estFee = Math.floor(ovr * 800 * (fighter.tier || 1));

        const w = window.AITransfers._computeFighterWillingness(fighter);
        let warnMsg = '';
        if (w.level === 'settled') warnMsg = `\n⚠️ WARNING: ${fighter.name} is settled here (${w.reasons.join(', ')}). Listing her will upset her and may cause team drama.`;

        if (!confirm(`List ${fighter.name} for transfer?\nEst. asking fee: ~$${estFee.toLocaleString()}${warnMsg}\n\nAI clubs will review and bid. Offers arrive in your Transfer Inbox.`)) return;

        if (gs.listedForTransfer && gs.listedForTransfer.find(l => l.fighterId === fighterId)) {
            alert(`${fighter.name} is already listed.`); return;
        }

        if (!gs.listedForTransfer) gs.listedForTransfer = [];
        gs.listedForTransfer.push({ fighterId, listedOnWeek: gs.week, askingFee: estFee });
        fighter.transfer_listed = true;

        // If settled, morale hit
        if (w.level === 'settled') {
            fighter.dynamic_state.morale = Math.max(0, (fighter.dynamic_state.morale || 50) - 15);
            fighter.dynamic_state.stress = Math.min(100, (fighter.dynamic_state.stress || 0) + 10);
        }

        gs.addNews('transfer', `${club.name} listed ${fighter.name} on the transfer market. Asking fee: ~$${estFee.toLocaleString()}.`);
        window.Router.loadRoute('transfers', { tab: 'roster' });
    },

    cancelListing(fighterId) {
        const gs = window.GameState;
        const fighter = gs.getFighter(fighterId);
        if (!fighter) return;
        gs.listedForTransfer = (gs.listedForTransfer || []).filter(l => l.fighterId !== fighterId);
        gs.transferInbox = (gs.transferInbox || []).filter(b => b.fighterId !== fighterId);
        fighter.transfer_listed = false;
        gs.addNews('transfer', `${fighter.name} has been taken off the transfer list.`);
        window.Router.loadRoute('transfers', { tab: 'roster' });
    },

    releaseAsFreeAgent(fighterId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        const fighter = gs.getFighter(fighterId);
        if (!fighter || club.fighter_ids.length <= 1) { alert('Cannot release your last fighter!'); return; }

        const remainingSeasons = fighter.contract ? (fighter.contract.seasons_remaining || 1) : 1;
        const yearlyWage = fighter.contract ? fighter.contract.salary : 0;

        // Academy Product exception: Free release in first years
        const isRookieAcademy = fighter.traits?.includes('academy_product') && fighter.age <= 21;
        const severance = isRookieAcademy ? 0 : yearlyWage * remainingSeasons;

        let confirmMsg = isRookieAcademy
            ? `Release rookie Academy Product ${fighter.name}?\nSeverance: $0 (Free Academy Release)\n\nShe will enter free agency.`
            : `Release ${fighter.name} as Free Agent?\nSeverance: $${severance.toLocaleString()} (${remainingSeasons} season(s) remaining)\n\nShe will enter free agency — AI clubs will compete for her.`;

        if (!confirm(confirmMsg)) return;
        if (gs.money < severance) { alert(`Insufficient funds. Need $${severance.toLocaleString()}.`); return; }

        gs.money -= severance;
        club.fighter_ids = club.fighter_ids.filter(id => id !== fighterId);
        fighter.club_id = null;
        fighter.transfer_listed = false;
        gs.listedForTransfer = (gs.listedForTransfer || []).filter(l => l.fighterId !== fighterId);
        gs.transferInbox = (gs.transferInbox || []).filter(b => b.fighterId !== fighterId);

        if (fighter.contract) {
            fighter.contract.seasons_remaining = 3;
            fighter.contract.happiness = 60;
            fighter.contract.demand_triggered = false;
            fighter.contract.salary = 0;
        }
        fighter.releasedByPlayerClub = true;
        gs.transferPool.push(fighter);
        const newsMsg = severance > 0
            ? `${club.name} released ${fighter.name}. Severance: $${severance.toLocaleString()}.`
            : `${club.name} released academy rookie ${fighter.name} on a free transfer.`;
        gs.addNews('transfer', newsMsg);
        if (typeof updateNavUI === 'function') updateNavUI();
        window.Router.loadRoute('transfers', { tab: 'roster' });
    },

    // ─── BOSMAN ────────────────────────────────────────────────────────────────

    initiateBosman(targetId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (club.fighter_ids.length >= 8) { alert('Roster full — release someone first.'); return; }

        const fighter = gs.getFighter(targetId);
        if (!fighter) return;
        const ovr = Math.round((fighter.core_stats.power + fighter.core_stats.technique + fighter.core_stats.speed) / 3);
        const ownerClub = gs.getClub(fighter.club_id);
        let minSalary = window.ContractEngine.getPerceivedWorth(fighter);

        let leverageMod = 1.0;
        if (gs.activeTransferLeverage && gs.activeTransferLeverage.targetFighter === fighter.id) {
            leverageMod = 0.8;
        }
        minSalary = Math.floor(minSalary * leverageMod);

        this._showOfferModal(fighter, 'bosman', minSalary, targetId);
    },
    executeBosmanMoves() {
        const gs = window.GameState;
        if (!gs.pendingBosmanMoves || gs.pendingBosmanMoves.length === 0) return;
        let executed = [];
        gs.pendingBosmanMoves.forEach(move => {
            const fighter = gs.getFighter(move.fighterId);
            const toClubId = move.toClubId || gs.playerClubId;
            const destClub = gs.getClub(toClubId);
            if (!fighter || !destClub) { executed.push(move); return; }
            const oldClub = gs.getClub(move.fromClubId);
            if (oldClub && oldClub.fighter_ids) oldClub.fighter_ids = oldClub.fighter_ids.filter(id => id !== move.fighterId);
            fighter.club_id = toClubId;
            fighter.contract = { salary: move.salary, seasons_remaining: move.duration || 3, new_this_tick: true, win_bonus: Math.floor(move.salary * 0.1), release_clause: move.releaseClause || (move.salary * 8), happiness: 90, demand_triggered: false };
            fighter.releasedByPlayerClub = false;
            if (!destClub.fighter_ids.includes(fighter.id)) destClub.fighter_ids.push(fighter.id);
            gs.addNews('transfer', `${fighter.name} officially joins ${destClub.name} (Bosman) for $${move.salary.toLocaleString()}/yr.`);
            executed.push(move);
        });
        gs.pendingBosmanMoves = gs.pendingBosmanMoves.filter(m => !executed.includes(m));
    },

    // ─── POACH / BUYOUT ────────────────────────────────────────────────────────

    initiatePoach(targetId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (club.fighter_ids.length >= 8) { alert('Roster is full!'); return; }
        const fighter = gs.getFighter(targetId);
        if (!fighter) return;
        const ownerClub = gs.getClub(fighter.club_id);
        const listedItem = (gs.listedForTransfer || []).find(l => l.fighterId === fighter.id);

        let finalFee = 0;
        let isFranchisePlayer = false;
        let hasClause = false;

        if (listedItem) {
            finalFee = listedItem.askingFee;
        } else {
            const ovr = Math.round((fighter.core_stats.power + fighter.core_stats.technique + fighter.core_stats.speed) / 3);
            let baseFee = Math.floor((ovr * 1500) + ((fighter.dynamic_state.fame || 0) * 20));

            let leverageMod = 1.0, usedLeverage = false;
            if (gs.activeTransferLeverage && gs.activeTransferLeverage.targetFighter === fighter.id) {
                leverageMod = 0.6; usedLeverage = true;
            }

            // FM-Style "Go Away" Pricing for Franchise Players
            const highestOvr = Math.max(0, ...(ownerClub?.fighter_ids || []).map(id => { const f = gs.getFighter(id); return f ? (f.core_stats.power + f.core_stats.technique + f.core_stats.speed) / 3 : 0; }));

            isFranchisePlayer = (ovr >= highestOvr - 2) && (fighter.age <= 24);
            let multiplier = 1.0;

            if (!usedLeverage) {
                if (isFranchisePlayer) {
                    multiplier = 3.0 + (Math.random() * 2.5); // 300% to 550% markup! "Not for sale"
                } else if (ovr >= highestOvr) {
                    multiplier = 2.0; // Standard star player premium
                }
            }

            finalFee = Math.floor(baseFee * multiplier * leverageMod);

            // ALWAYS respect the release clause if it exists and is lower than their extortionate demand!
            if (fighter.contract && fighter.contract.release_clause > 0) {
                if (finalFee > fighter.contract.release_clause) {
                    finalFee = fighter.contract.release_clause;
                    hasClause = true;
                }
            }
        }

        // Calculate minimum salary expectations
        let salMin = window.ContractEngine.getPerceivedWorth(fighter);

        // Happiness Tax: If she is very happy at her current club, she demands a massive wage increase to leave
        let curHappy = fighter.contract ? (fighter.contract.happiness || 50) : 50;
        if (curHappy >= 85) {
            salMin = Math.floor(salMin * 1.8);
        } else if (curHappy >= 70) {
            salMin = Math.floor(salMin * 1.3);
        }

        this._showOfferModal(fighter, 'poach', salMin, targetId, finalFee, isFranchisePlayer, hasClause, ownerClub?.name);
    },

    // ─── FREE AGENT BID ────────────────────────────────────────────────────────

    initiateBid(fighterId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        if (club.fighter_ids.length >= 8) { alert('Roster is full! Release someone first.'); return; }

        // Accepts a fighter ID (string) — find fighter in transferPool by ID
        const fighter = gs.transferPool.find(f => f.id === fighterId) || gs.getFighter(fighterId);
        if (!fighter) return;

        const cs = fighter.core_stats;
        const ovr = (cs.power + cs.technique + cs.speed) / 3;
        let baseReq = window.ContractEngine.getPerceivedWorth(fighter);
        if (fighter.releasedByPlayerClub) baseReq = Math.floor(baseReq * 1.25);

        this._showOfferModal(fighter, 'free_agent', baseReq, fighterId);
    },

    _showOfferModal(fighter, context, baseReq, idxOrId, finalFee = 0, isFranchisePlayer = false, hasClause = false, ownerClubName = '') {
        if (window.UIComponents) window.UIComponents.closeModal();

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

        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);

        const cs = fighter.core_stats;
        const ovr = Math.floor((cs.power + cs.technique + cs.speed) / 3);
        const imgSrc = fighter.avatar ? `assets/portraits/${fighter.avatar}` : `assets/portraits/${fighter.name.toLowerCase()}.png`;
        const fallback = window.UIComponents._makeInitialsAvatar(fighter.name, '#888');

        // Build expected demands
        let expectedDuration = Math.min(4, Math.max(1, 5 - Math.floor(fighter.age / 10)));
        if (fighter.personality?.archetype === 'Showboat') expectedDuration = Math.max(1, expectedDuration - 1);
        let expectedClause = baseReq * 8;

        let contextTxt = "";
        if (context === 'bosman') {
            contextTxt = "No transfer fee required. She will join your club at the end of the current season.";
        } else if (context === 'poach') {
            if (hasClause) {
                contextTxt = `She has a release clause of <strong style="color:var(--accent);">$${finalFee.toLocaleString()}</strong>. If she accepts your contract, this fee will be paid to ${ownerClubName}.`;
            } else if (isFranchisePlayer) {
                contextTxt = `${ownerClubName} considers her a franchise player and demands an extortionate <strong style="color:#ff5252;">$${finalFee.toLocaleString()}</strong> transfer fee.`;
            } else {
                contextTxt = `${ownerClubName} demands a transfer fee of <strong style="color:#ffaa00;">$${finalFee.toLocaleString()}</strong>. This will be deducted if she accepts your offer.`;
            }
        } else {
            contextTxt = "She is a Free Agent and will join your club immediately.";
        }

        // Determine favorite style from affinities
        let favStyleStr = 'Mixed Martial Arts';
        if (fighter.style_affinities) {
            const styleNames = { boxing: '🥊 Boxing', naked_wrestling: '🤼 Wrestling', catfight: '🐈 Catfight', sexfight: '💋 Sexfight' };
            let highestAfinity = 0;
            let bestStyleKey = null;
            for (const [key, val] of Object.entries(fighter.style_affinities)) {
                if (val > highestAfinity) {
                    highestAfinity = val;
                    bestStyleKey = key;
                }
            }
            if (bestStyleKey && styleNames[bestStyleKey]) {
                favStyleStr = styleNames[bestStyleKey];
            }
        }

        let statsHtml = '';
        if (fighter.scouted) {
            const getColor = (v) => v >= 90 ? '#00e676' : v >= 80 ? '#28a0e0' : v >= 70 ? '#ffaa00' : '#fff';
            statsHtml = `
                <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
                    <h3 style="color:var(--text-muted); font-size: 0.85rem; text-transform:uppercase; margin-bottom: 0.8rem;">Scouted Attributes</h3>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem;">
                        <div style="font-size: 0.9rem;">Power: <span style="color:${getColor(cs.power)}; font-weight:bold; float:right;">${Math.round(cs.power)}</span></div>
                        <div style="font-size: 0.9rem;">Technique: <span style="color:${getColor(cs.technique)}; font-weight:bold; float:right;">${Math.round(cs.technique)}</span></div>
                        <div style="font-size: 0.9rem;">Speed: <span style="color:${getColor(cs.speed)}; font-weight:bold; float:right;">${Math.round(cs.speed)}</span></div>
                        <div style="font-size: 0.9rem;">Control: <span style="color:${getColor(cs.control)}; font-weight:bold; float:right;">${Math.round(cs.control)}</span></div>
                        <div style="font-size: 0.9rem;">Endurance: <span style="color:${getColor(cs.endurance)}; font-weight:bold; float:right;">${Math.round(cs.endurance)}</span></div>
                        <div style="font-size: 0.9rem;">Resilience: <span style="color:${getColor(cs.resilience)}; font-weight:bold; float:right;">${Math.round(cs.resilience)}</span></div>
                        <div style="font-size: 0.9rem;">Aggression: <span style="color:${getColor(cs.aggression)}; font-weight:bold; float:right;">${Math.round(cs.aggression)}</span></div>
                        <div style="font-size: 0.9rem;">Composure: <span style="color:${getColor(cs.composure)}; font-weight:bold; float:right;">${Math.round(cs.composure)}</span></div>
                        <div style="font-size: 0.9rem;">Presence: <span style="color:${getColor(cs.presence)}; font-weight:bold; float:right;">${Math.round(cs.presence)}</span></div>
                    </div>
                </div>
            `;
        }

        overlay.innerHTML = `
            <div style="background: rgba(20, 20, 25, 0.95); border: 1px solid rgba(255,255,255,0.1); border-top: 4px solid var(--accent); padding: 2rem; border-radius: 12px; max-width: 650px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.8); font-family: 'Inter', sans-serif; max-height: 90vh; overflow-y: auto;">
                
                <div style="display:flex; gap:1.5rem; align-items:center; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem;">
                    <img src="${imgSrc}" onerror="this.src='${fallback}'" style="width:100px; height:100px; border-radius:12px; object-fit:cover; border:3px solid var(--accent);">
                    <div style="flex:1;">
                        <h2 style="font-family: 'Outfit', sans-serif; color: #fff; margin: 0 0 0.3rem 0; font-size: 1.8rem;">${fighter.name}</h2>
                        <div style="color:var(--text-muted); font-size: 0.95rem; display:flex; gap:1rem; align-items:center; flex-wrap: wrap;">
                            <span>Age: <strong style="color:#fff;">${fighter.age}</strong></span>
                            <span>OVR: <strong style="color:var(--accent);">${ovr}</strong></span>
                            <span>Style: <strong style="color:#fff;">${favStyleStr}</strong></span>
                            <span>Archetype: <strong style="color:#fff;">${fighter.personality?.archetype || 'Unknown'}</strong></span>
                        </div>
                        <p style="font-size:0.85rem; color:#aaa; margin-top:0.8rem; line-height:1.4;">${contextTxt}</p>
                    </div>
                </div>
                
                ${statsHtml}
                
                <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;" id="neg-feedback-box">
                    <p style="color: #ccc; margin: 0; line-height: 1.5;"><strong>Agent:</strong> "My client is very interested in joining ${club.name}. We are looking for a deal around <strong>$${baseReq.toLocaleString()}/yr</strong> for <strong>${expectedDuration} year(s)</strong>, with a release clause of <strong>$${expectedClause.toLocaleString()}</strong>."</p>
                </div>

                <div id="neg-inputs" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 2rem;">
                    <div>
                        <label style="display:block; font-size: 0.8rem; color:var(--text-muted); margin-bottom: 0.5rem; text-transform:uppercase;">Annual Salary ($)</label>
                        <input type="number" id="neg-offer-salary" value="${baseReq}" style="width:100%; padding: 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 4px; font-size: 1.1rem; outline: none;">
                    </div>
                    <div>
                        <label style="display:block; font-size: 0.8rem; color:var(--text-muted); margin-bottom: 0.5rem; text-transform:uppercase;">Duration (Years)</label>
                        <select id="neg-offer-duration" style="width:100%; padding: 0.8rem; background: #222; border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 4px; font-size: 1.1rem; outline: none; appearance: auto;">
                            <option value="1" ${expectedDuration === 1 ? 'selected' : ''}>1 Year</option>
                            <option value="2" ${expectedDuration === 2 ? 'selected' : ''}>2 Years</option>
                            <option value="3" ${expectedDuration === 3 ? 'selected' : ''}>3 Years</option>
                            <option value="4" ${expectedDuration === 4 ? 'selected' : ''}>4 Years</option>
                            <option value="5" ${expectedDuration === 5 ? 'selected' : ''}>5 Years</option>
                        </select>
                    </div>
                    <div>
                        <label style="display:block; font-size: 0.8rem; color:var(--text-muted); margin-bottom: 0.5rem; text-transform:uppercase;">Release Clause ($)</label>
                        <input type="number" id="neg-offer-clause" value="${expectedClause}" style="width:100%; padding: 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 4px; font-size: 1.1rem; outline: none;">
                    </div>
                </div>

                <div id="neg-actions" style="display: flex; justify-content: flex-end; gap: 1rem;">
                    <button id="neg-btn-walk" style="background: transparent; color: #ff5252; border: 1px solid #ff5252; padding: 10px 20px; border-radius: 4px; font-weight: bold; cursor: pointer;">Cancel</button>
                    <button id="neg-btn-submit" style="background: var(--accent); color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Submit Offer</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('neg-btn-walk').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('neg-btn-submit').addEventListener('click', () => {
            let sInput = parseInt(document.getElementById('neg-offer-salary').value);
            let dInput = parseInt(document.getElementById('neg-offer-duration').value);
            let cInput = parseInt(document.getElementById('neg-offer-clause').value);

            if (isNaN(sInput) || sInput <= 0) return;
            if (isNaN(cInput) || cInput <= 0) cInput = sInput * 8;

            if (context === 'bosman') {
                this._processBosmanOffer(fighter, sInput, dInput, cInput, baseReq, idxOrId);
            } else if (context === 'poach') {
                this._processPoachOffer(fighter, sInput, dInput, cInput, baseReq, idxOrId, finalFee);
            } else {
                this._processFreeAgentOffer(fighter, sInput, dInput, cInput, baseReq, idxOrId);
            }
        });
    },

    _processPoachOffer(fighter, offer, duration, clause, minSalary, targetId, finalFee) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);
        const ownerClub = gs.getClub(fighter.club_id);

        const feedbackBox = document.getElementById('neg-feedback-box');
        const actionBox = document.getElementById('neg-actions');
        const inputsBox = document.getElementById('neg-inputs');

        // Check transfer fee BEFORE evaluating the contract
        if (gs.money < finalFee) {
            feedbackBox.innerHTML = `<p style="color: #ff5252; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Insufficient Funds:</strong> "You don't have enough liquid cash to pay the $${finalFee.toLocaleString()} transfer fee to our current club. We are wasting our time."</p>`;
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove();" style="background: #333; color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close</button>`;
            return;
        }

        // Evaluate salary
        const aiCounter = minSalary + (Math.floor(Math.random() * 8000) - 2000);

        if (offer >= aiCounter && offer >= minSalary) {
            // Success: Deduct transfer fee & Sign Contract
            gs.money -= finalFee;
            if (ownerClub) {
                ownerClub.money = (ownerClub.money || 100000) + finalFee;
                ownerClub.fighter_ids = ownerClub.fighter_ids.filter(id => id !== fighter.id);
            }
            if (gs.activeTransferLeverage) gs.activeTransferLeverage = null;

            fighter.contract = { salary: offer, seasons_remaining: duration, win_bonus: Math.floor(offer * 0.1), release_clause: clause, happiness: 85, demand_triggered: false };
            fighter.club_id = club.id;
            club.fighter_ids.push(fighter.id);
            gs.addNews('transfer', `BLOCKBUSTER: ${club.name} activated the $${finalFee.toLocaleString()} buyout for ${fighter.name}!`);

            feedbackBox.innerHTML = `<p style="color: #00e676; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Success:</strong> "We have a deal! I will inform ${ownerClub?.name || 'the club'} that you are paying the $${finalFee.toLocaleString()} transfer fee."</p>`;
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';

            this._rebuildGlobalTargetsCache();
            if (typeof updateNavUI === 'function') updateNavUI();

            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove(); window.Router.loadRoute('transfers', { tab: 'scout' });" style="background: #00e676; color: #000; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Finalize Transfer</button>`;
        } else {
            // Failed: Keep fighter at current club, no fee deducted
            gs.addNews('transfer', `${club.name} attempted a buyout for ${fighter.name} but salary talks collapsed.`);
            feedbackBox.innerHTML = `<p style="color: #ffaa00; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Talks Collapsed:</strong> "This offer is unacceptable. My client is perfectly happy staying at her current club. We are walking away."</p>`;

            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove();" style="background: #333; color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close</button>`;
        }
    },

    _processFreeAgentOffer(fighter, offer, duration, clause, minSalary, poolIdx) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);

        const aiCounter = minSalary + (Math.floor(Math.random() * 8000) - 2000) + (fighter.releasedByPlayerClub ? Math.floor(Math.random() * 6000) : 0);

        const feedbackBox = document.getElementById('neg-feedback-box');
        const actionBox = document.getElementById('neg-actions');
        const inputsBox = document.getElementById('neg-inputs');

        if (offer >= aiCounter && offer >= minSalary) {
            gs.money -= offer;
            fighter.contract = { salary: offer, seasons_remaining: duration, win_bonus: Math.floor(offer * 0.1), release_clause: clause, happiness: 80, demand_triggered: false };
            fighter.club_id = club.id;
            fighter.transfer_listed = false;
            fighter.releasedByPlayerClub = false;
            gs.fighters[fighter.id] = fighter;
            club.fighter_ids.push(fighter.id);
            // Remove from pool using the ID passed as poolIdx (was renamed from index to ID)
            const poolIndex = gs.transferPool.findIndex(f => f.id === (typeof poolIdx === 'string' ? poolIdx : (gs.transferPool[poolIdx]?.id)));
            if (poolIndex !== -1) gs.transferPool.splice(poolIndex, 1);
            // Also clean up listing/inbox in case it was also on the transfer list
            gs.listedForTransfer = (gs.listedForTransfer || []).filter(l => l.fighterId !== fighter.id);
            gs.transferInbox = (gs.transferInbox || []).filter(b => b.fighterId !== fighter.id);
            gs.addNews('transfer', `${club.name} signed ${fighter.name} for $${offer.toLocaleString()}/yr!`);

            feedbackBox.innerHTML = `<p style="color: #00e676; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Success:</strong> "We have a deal! I'll prepare the paperwork right away."</p>`;
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove(); window.Router.loadRoute('transfers', { tab: 'free' });" style="background: #00e676; color: #000; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close & Confirm</button>`;
        } else {
            let hijacked = false;
            if (window.AITransfers && window.AITransfers.attemptAIHijack) {
                hijacked = window.AITransfers.attemptAIHijack(fighter, Math.max(aiCounter, minSalary), false);
            }
            if (!hijacked) {
                gs.addNews('transfer', `${fighter.name} rejected ${club.name}'s offer, feeling she is worth more.`);
                feedbackBox.innerHTML = `<p style="color: #ff5252; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Rejected:</strong> "This offer is unacceptable. We need at least <strong>$${Math.max(aiCounter, minSalary).toLocaleString()}</strong>. We are walking away."</p>`;
            } else {
                feedbackBox.innerHTML = `<p style="color: #ff5252; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Hijacked:</strong> "Hold on... my phone is ringing. We just received a much better offer from a rival club. The deal is off!"</p>`;
            }
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove(); window.Router.loadRoute('transfers', { tab: 'free' });" style="background: #333; color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close</button>`;
        }
        if (typeof updateNavUI === 'function') updateNavUI();
    },

    _processBosmanOffer(fighter, offer, duration, clause, minSalary, targetId) {
        const gs = window.GameState;
        const club = gs.getClub(gs.playerClubId);

        const feedbackBox = document.getElementById('neg-feedback-box');
        const actionBox = document.getElementById('neg-actions');
        const inputsBox = document.getElementById('neg-inputs');

        if (offer < minSalary) {
            feedbackBox.innerHTML = `<p style="color: #ff5252; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Rejected:</strong> "Don't insult us. She needs at least $${minSalary.toLocaleString()}/yr."</p>`;
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove();" style="background: #333; color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close</button>`;
            return;
        }

        const aiOffer = minSalary + Math.floor(Math.random() * 8000);
        if (offer < aiOffer && Math.random() < 0.5) {
            let hijacked = false;
            if (window.AITransfers && window.AITransfers.attemptAIHijack) {
                hijacked = window.AITransfers.attemptAIHijack(fighter, aiOffer, true);
            }
            if (!hijacked) {
                gs.addNews('transfer', `${fighter.name} rejected a Bosman offer from ${club.name}, deciding to wait for better options.`);
            }
            feedbackBox.innerHTML = `<p style="color: #ff5252; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Rejected:</strong> "We have other offers on the table. This isn't competitive enough."</p>`;
            inputsBox.style.opacity = '0.3';
            inputsBox.style.pointerEvents = 'none';
            actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove();" style="background: #333; color: #fff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close</button>`;
            return;
        }

        if (!gs.pendingBosmanMoves) gs.pendingBosmanMoves = [];
        gs.pendingBosmanMoves.push({ fighterId: fighter.id, fromClubId: fighter.club_id, salary: offer, duration: duration, releaseClause: clause, agreementWeek: gs.week, agreementSeason: gs.season });
        if (gs.activeTransferLeverage?.targetFighter === fighter.id) gs.activeTransferLeverage = null;

        gs.addNews('transfer', `${club.name} pre-signed ${fighter.name} (Bosman) for $${offer.toLocaleString()}/yr.`);

        feedbackBox.innerHTML = `<p style="color: #00e676; margin: 0; line-height: 1.5; font-size: 1.1rem;"><strong>Success:</strong> "Pre-contract signed! She will join your club at the end of the season."</p>`;
        inputsBox.style.opacity = '0.3';
        inputsBox.style.pointerEvents = 'none';
        actionBox.innerHTML = `<button onclick="document.getElementById('global-modal-overlay').remove(); window.Router.loadRoute('transfers', { tab: 'scout' });" style="background: #00e676; color: #000; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer;">Close & Confirm</button>`;

        if (typeof updateNavUI === 'function') updateNavUI();
    },

    // ─── SCOUTING ──────────────────────────────────────────────────────────────

    scoutFighter(targetId, poolIdx) {
        const gs = window.GameState;
        if (gs.actionPoints < 1) { alert('Not enough Action Points.'); return; }

        let hasAnalyst = false;
        let pClub = gs.getClub(gs.playerClubId);
        if (pClub && pClub.staff) {
            Object.values(pClub.staff).forEach(sId => {
                if (gs.staff[sId] && gs.staff[sId].trait === 'Analyst') hasAnalyst = true;
            });
        }

        if (hasAnalyst && Math.random() < 0.5) {
            // Analyst saves the AP
        } else {
            gs.actionPoints--;
        }

        // --- Save Game Object Desync Fix ---
        // Loaded saves may have deep-copied objects, meaning the fighter in gs.fighters 
        // is NOT the same memory reference as the one in gs.transferPool.
        // We must explicitly set .scouted = true on BOTH copies if they exist.

        // 1. Update Global Dictionary
        if (targetId && gs.fighters && gs.fighters[targetId]) {
            gs.fighters[targetId].scouted = true;
        }

        // 2. Update Transfer Pool
        let poolFighter = null;
        if (targetId) {
            poolFighter = gs.transferPool.find(pf => pf.id === targetId);
            if (poolFighter) poolFighter.scouted = true;
        } else if (poolIdx !== null && poolIdx !== undefined) {
            poolFighter = gs.transferPool[poolIdx];
            if (poolFighter) poolFighter.scouted = true;
        }

        gs._globalTargetsCache = null;
        if (typeof updateNavUI === 'function') updateNavUI();

        // Route back to the exact tab we are on, and pass targetId so it auto-opens the negotiation modal!
        let nextRouteParams = { tab: this._activeTab || 'scout' };
        if ((this._activeTab === 'scout' || this._activeTab === 'free') && targetId) {
            nextRouteParams.targetId = targetId;
        }

        window.Router.loadRoute('transfers', nextRouteParams);
    },

    // ─── HELPERS ───────────────────────────────────────────────────────────────

    _getBosmanTargets() {
        const gs = window.GameState;
        return Object.values(gs.fighters).filter(f =>
            f.club_id && f.club_id !== gs.playerClubId && !f.retired &&
            f.contract && f.contract.seasons_remaining === 1 && !f.contract.renewed_this_offseason
        ).sort((a, b) => (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) - (a.core_stats.power + a.core_stats.technique + a.core_stats.speed));
    },

    _rebuildGlobalTargetsCache() {
        const gs = window.GameState;
        gs._globalTargetsCache = Object.values(gs.fighters).filter(f => f.club_id && f.club_id !== gs.playerClubId && !f.retired);
        gs._globalTargetsCache.sort((a, b) => (b.core_stats.power + b.core_stats.technique + b.core_stats.speed) - (a.core_stats.power + a.core_stats.technique + a.core_stats.speed));
    },

    // Legacy shim — called by old code paths
    processListedTransfers() {
        // Bids are now generated by AITransfers._generateInboxBids() each week.
        // This shim exists so any old references don't crash.
        this._rebuildGlobalTargetsCache();
    }
};