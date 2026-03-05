const fs = require('fs');
const path = require('path');

const targetPath = path.resolve('C:/Users/AnilTurkmayali/Downloads/Clubs/data_fighters.json');

try {
    let data = fs.readFileSync(targetPath, 'utf8');
    // Using a regex to find all "release_clause": <number> and multiply by 3
    let updatedData = data.replace(/"release_clause":\s*(\d+)/g, (match, p1) => {
        let oldVal = parseInt(p1);
        let newVal = oldVal * 3; // Increase by 3x to match the new x10 / x8 scaling vs the old x3 / x4 scaling
        return `"release_clause": ${newVal}`;
    });

    fs.writeFileSync(targetPath, updatedData, 'utf8');
    console.log("Successfully updated data_fighters.json release clauses.");
} catch (e) {
    console.error("Error patching data_fighters: ", e);
}
