# ACC GATES RUNNER — Windows-native (interop WSL tidak dipakai).
# Jalankan dari C:\Workspace\Aether:
#   powershell -ExecutionPolicy Bypass -File scripts\acc-gates.ps1
param()
$ErrorActionPreference = "Continue"
cd $PSScriptRoot\..

$log = "C:\Workspace\Aether\.tmp-closure\acc-gates.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Set-Content -Path $log -Value "ACC C0 GATES" -Encoding UTF8
$totals = New-Object System.Collections.ArrayList

function Run([string]$name, [string[]]$cmd) {
  "===== STEP $name =====" | Out-File $log -Append -Encoding UTF8
  $out = & $cmd[0] $cmd[1..($cmd.Length-1)] 2>&1
  $code = $LASTEXITCODE
  $out | Out-File $log -Append -Encoding UTF8
  $txt = ($out | Out-String)
  $row = ordered @{ step=$name; exit=$code; tests=$null; pass=$null; fail=$null; skipped=$null }
  foreach ($k in @('tests','pass','fail','skipped')) {
    $line = ($txt -split "`n" | Where-Object { $_ -match "(^|\s)$k \d+\s*$" } | Select-Object -Last 1)
    if ($line -match "$k (\d+)\s*$") { $row[$k] = [int]$Matches[1] }
  }
  [void]$totals.Add([pscustomobject]$row)
  Write-Host ("GATE {0}: exit={1} tests={2} pass={3} fail={4}" -f $name,$code,$row.tests,$row.pass,$row.fail)
}

$T = @("--test-concurrency=1","--require","./tests/helpers/testEnv.js","--test-force-exit")

# ---- ACC targeted ----
Run "c0_1_continuity"    @("node","--test",$T[0],$T[1],$T[2],$T[3],"tests/cognition/accContinuity.test.js")
Run "c0_2_epistemics"    @("node","--test",$T[0],$T[1],$T[2],$T[3],"tests/cognition/accEpistemics.test.js")
Run "c0_3_affect_intero" @("node","--test",$T[0],$T[1],$T[2],$T[3],"tests/cognition/accAffectInteroception.test.js")
Run "c0_4_workspace"     @("node","--test",$T[0],$T[1],$T[2],$T[3],"tests/cognition/accWorkspace.test.js")
Run "c0_5_witness_meta_prediction" @("node","--test",$T[0],$T[1],$T[2],$T[3],"tests/cognition/accWitnessMetaPrediction.test.js")
Run "c0_678_bio_substrate_security" @("node","--test",$T[0],$T[1],$T[2],$T[3],
   "tests/cognition/accAutobiographySubstrateSecurity.test.js")

# ---- Foundation regressions (§111): ACC tidak boleh menyentuh ini ----
Run "foundation_authority" @("node","--test",$T[0],$T[1],$T[2],$T[3],
  "tests/safety/authoritySurface.test.js",
  "tests/safety/delegationAuthority.test.js",
  "tests/safety/delegationGrantSites.test.js",
  "tests/safety/capabilitySetParity.test.js",
  "tests/safety/boundedDelegationE2E.test.js",
  "tests/safety/m1RestrictionPreservation.test.js")

"===TOTALS===" | Out-File $log -Append -Encoding UTF8
foreach ($t in $totals) {
  ("step={0} exit={1} tests={2} pass={3} fail={4} skipped={5}" -f $t.step,$t.exit,$t.tests,$t.pass,$t.fail,$t.skipped) |
    Out-File $log -Append -Encoding UTF8
}
"ACC_GATES_DONE" | Out-File $log -Append -Encoding UTF8
Write-Host "Log: $log"
