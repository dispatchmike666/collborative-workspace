' Starts run-glasshouse.ps1 with its window hidden from the very first moment, so nothing
' flashes on screen at login. Started by the "Glasshouse" task that install.ps1 adds.
Dim shell, fso, here, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\run-glasshouse.ps1"""
' 0 = hidden window. True = wait, so Windows shows the task as running while Glasshouse runs.
WScript.Quit shell.Run(command, 0, True)
