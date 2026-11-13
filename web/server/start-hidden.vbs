Option Explicit
Dim fs, shell, root, nodePath, command, result
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName)))
nodePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe"
If Not fs.FileExists(nodePath) Then nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fs.FileExists(nodePath) Then WScript.Quit 127
shell.CurrentDirectory = root
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & root & "\web\server\bridge.mjs" & Chr(34) & " coordinator"
' 0 = SW_HIDE, True = wait for the service process and report its exit code.
' wscript.exe has no console, so no CMD/Windows Terminal taskbar window is created.
result = shell.Run(command, 0, True)
WScript.Quit result
