$path = "C:\Users\AnilTurkmayali\Downloads\Clubs\data_fighters.json"
$json = Get-Content -Raw $path | ConvertFrom-Json
foreach ($f in $json) {
    if ($null -ne $f.contract) {
        if ($null -ne $f.contract.release_clause) {
            $f.contract.release_clause = $f.contract.release_clause * 3
        }
    }
}
$json | ConvertTo-Json -Depth 10 | Set-Content $path -Encoding UTF8
Write-Output "Successfully updated data_fighters.json release clauses via PowerShell JSON parser."
