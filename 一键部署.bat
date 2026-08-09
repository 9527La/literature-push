@echo off
chcp 65001 >nul 2>&1
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1"
