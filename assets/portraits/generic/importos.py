import os

# -------------------------------------------------------
# Change this to your actual folder path
# -------------------------------------------------------
folder = r"C:\Users\AnilTurkmayali\Downloads\Clubs\assets\portraits\generic"

# Get all PNG files that are NOT already renamed
# (skips anything already named like 1.png to 150.png)
already_done = set(str(i) + '.png' for i in range(1, 151))

# Get remaining files sorted by name
remaining = sorted([
    f for f in os.listdir(folder)
    if f.endswith('.png') and f not in already_done
])

print(f"Found {len(remaining)} files to rename")

# Rename starting from 151
for i, filename in enumerate(remaining, start=151):
    old_path = os.path.join(folder, filename)
    new_name = f"{i}.png"
    new_path = os.path.join(folder, new_name)
    os.rename(old_path, new_path)
    print(f"{filename} → {new_name}")

print(f"\nDone! Renamed {len(remaining)} files (151 to {150 + len(remaining)})")