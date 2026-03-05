import json
import os

path = r"C:\Users\AnilTurkmayali\Downloads\Clubs\data_fighters.json"
try:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for fighter in data:
        if 'contract' in fighter and 'release_clause' in fighter['contract']:
            fighter['contract']['release_clause'] *= 3
            
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
    print("Successfully updated release clauses using Python.")
except Exception as e:
    print(f"Error: {e}")
