/**
 * save_system.js
 * Serializes and hydrates GameState to window.localStorage
 */

window.SaveSystem = {
    saveKey: 'club_dynasty_autosave',

    saveGame() {
        try {
            const data = JSON.stringify(window.GameState);
            localStorage.setItem(this.saveKey, data);
            console.log("Game Saved Successfully.");
            return true;
        } catch (e) {
            console.error("Failed to save game data", e);
            return false;
        }
    },

    loadGame() {
        try {
            const data = localStorage.getItem(this.saveKey);
            if (!data) return false;

            const parsed = JSON.parse(data);

            // Hydrate state
            Object.assign(window.GameState, parsed);

            // Backward compatibility for new expansion variables that might be missing in older saves
            if (!window.GameState.pendingMilestones) window.GameState.pendingMilestones = [];
            if (!window.GameState.undergroundHistory) window.GameState.undergroundHistory = [];
            if (typeof window.GameState.undergroundAvailableThisWeek === 'undefined') window.GameState.undergroundAvailableThisWeek = true;
            if (!window.GameState.relationshipGraph) window.GameState.relationshipGraph = {};

            // Migrate: fix corrupted avatar strings (.webp or double prefixes) from older saves
            const PORTRAIT_PREFIX = 'assets/portraits/';
            if (window.GameState.fighters) {
                Object.values(window.GameState.fighters).forEach(f => {
                    if (f.avatar) {
                        if (f.avatar.startsWith(PORTRAIT_PREFIX)) {
                            f.avatar = f.avatar.slice(PORTRAIT_PREFIX.length);
                        }
                        if (f.avatar.endsWith('.webp') || f.avatar.endsWith('.webp:1')) {
                            f.avatar = f.avatar.replace(/\.webp(:\d+)?$/, '.png');
                        }
                    }
                });
            }

            console.log("Game Loaded Successfully.");

            // Re-render nav
            if (typeof updateNavUI === 'function') updateNavUI();

            return true;
        } catch (e) {
            console.error("Failed to load game data", e);
            return false;
        }
    },

    exportSaveFile() {
        try {
            const data = localStorage.getItem(this.saveKey);
            if (!data) return alert("No current local save found to export.");

            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `club_dynasty_save_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log("Save file exported.");
        } catch (e) {
            console.error("Export failed:", e);
            alert("Failed to export save file.");
        }
    },

    importSaveFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const parsed = JSON.parse(content);

                // Basic validation
                if (!parsed.clubs || !parsed.fighters) {
                    throw new Error("Missing required GameState properties.");
                }

                // Verify it doesn't break the local storage limits
                localStorage.setItem(this.saveKey, content);
                alert("Save file imported successfully! Click 'Continue Saved Game' to load it.");

                // Re-render UI to expose the Continue button if it was hidden
                if (window.UIStart) {
                    window.UIStart.render();
                }

            } catch (err) {
                console.error("Import failed:", err);
                alert("Failed to parse save file. Make sure it is a valid Club Dynasty JSON save.");
            }
            // Reset input
            event.target.value = "";
        };
        reader.readAsText(file);
    },

    clearSave() {
        localStorage.removeItem(this.saveKey);
        console.log("Save cleared.");
    }
};

// Autosave is now called directly from AIEngine._advanceTime()
// (monkey-patch removed to prevent hook chain race conditions)