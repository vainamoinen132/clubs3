# How the Combat Engine Decides Winners

You noticed that an 84 OVR "Elite Catfight" fighter can beat a 99 OVR "Elite Sexfight" fighter in a Catfight match. This is actually a sign that the engine is working exactly as intended! 

OVR (Overall Rating) is **not** used to calculate fight results. It’s just an average of three basic stats (`(Power + Technique + Speed) / 3`) to give you a quick estimate of a fighter's general physical conditioning. 

When a fight actually happens, the engine uses **highly specific math based on the match style**, which heavily punishes fighters who fight out of their comfort zone.

Here is the exact breakdown of why the 84 OVR Catfighter destroys the 99 OVR Sexfighter in a Catfight:

### 1. The "Elite Master" Multiplier
In `sim_engine.js`, before the fight even begins, the system checks if a fighter's Style Affinity for the current match type is 90+. 
- Your 84 OVR Elite Catfighter gets a **massive 10% bonus** to her Power, Speed, Technique, and Resilience because she is fighting in her Elite style.
- The 99 OVR Sexfighter gets **no bonus** because her Catfight affinity is likely much lower than 90.

### 2. Style-Specific Stat Weighting
Every style uses completely different stats to determine who wins an exchange. According to `sim_rounds.js`:
- In a **Sexfight**, the primary stats are **Composure** and **Presence**. The 99 OVR Sexfighter has these maxed out.
- However, in a **Catfight**, the primary stats are **Aggression** (50% weight) and **Power** (30% weight). 

Because the Sexfighter is specialized for Sexfight, her Aggression is likely much lower than the Catfighter's, making her 99 OVR meaningless in this specific ruleset.

### 3. The Affinity Score Contribution
In every single exchange (punch/grapple), a fighter's Attack Score is calculated.
`Attack Score = (Primary Stat * 0.5) + (Secondary Stat * 0.3) + (Style Affinity * 0.2)`

The Elite Catfighter has a ~95-100 Catfight Affinity. This adds a flat ~20 points to every single attack she throws. The Elite Sexfighter likely has a Catfight Affinity around 50-60, meaning she loses 8-10 points of "Attack Score" purely because she doesn't know the proper techniques for Catfighting.

### 4. Stance and Fatigue
Because the Sexfighter is missing attacks and losing exchanges (due to bad Catfight Affinity), she drains her stamina faster. Once stamina drops below 40, she suffers severe stat penalties (-10 Speed, -8 Power), creating a death spiral where she becomes sluggish and gets knocked out.

---

## How to Improve the System Further

While the system is working well to simulate "Styles Make Fights", here are a few ways we could improve it to make it even more strategic:

1. **Warn the Player During Matchmaking:**
   Right now, players just see "99 OVR" and assume she will win anything. We could add a UI warning: `"⚠️ Warning: This fighter is fighting out of her primary style (Catfight: 52). She will suffer severe performance penalties."`

2. **Cross-Training / Defensive Affinities:**
   Currently, if you aren't good at Catfight, you can't throw a good Catfight attack. But we could update the engine so that high Technique/Composure allows an Elite Sexfighter to "neutralize" Catfight attacks better (increasing her *defense* score even if she can't attack well). This would cause these mismatch fights to go the distance (decisions) rather than ending in brutal KOs.

3. **In-Fight Adaptability:**
   Fighters with high "Intelligence" or "Technique" could learn during the fight. If a 99 OVR Sexfighter is getting beaten up in Round 1 of a Catfight, her stats could allow her to adapt her defense by Round 3 to stop taking so much damage.
