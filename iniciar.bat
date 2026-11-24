@echo off
chcp 65001 >nul
title EcoSafety ^& EcoClinic — Plataforma Integrada
echo ==============================================================
echo  Iniciando Plataforma Integrada EcoSafety ^& EcoClinic...
echo  Modulos: Portal Central + Lista de Presenca + Triagem Clinica
echo ==============================================================
echo.
node local-server.js
pause
