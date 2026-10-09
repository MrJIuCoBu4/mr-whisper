const { spawnSync } = require("child_process");

const PS_PREFIX = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
`.trim();

function runPowerShell(script, timeoutMs = 2000) {
  try {
    return spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8" }
    );
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error?.message || error) };
  }
}

function isWindowsTextInputFocused() {
  const result = runPowerShell(
    `${PS_PREFIX}
$el = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $el) { exit 1 }
if (-not $el.Current.IsEnabled) { exit 1 }

try {
  $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp -and -not $vp.Current.IsReadOnly) { exit 0 }
} catch {}

try {
  $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  if ($tp) { exit 0 }
} catch {}

$ct = $el.Current.ControlType.ProgrammaticName
$editableTypes = @(
  'ControlType.Edit',
  'ControlType.Document',
  'ControlType.ComboBox',
  'ControlType.Text',
  'ControlType.Spinner',
  'ControlType.Password'
)
if ($editableTypes -contains $ct) { exit 0 }

exit 1`
  );
  return result.status === 0;
}

module.exports = { isWindowsTextInputFocused };
