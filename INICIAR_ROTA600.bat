@echo off
title SISTEMA ROTA 600 - CAIXA
echo Aguarde... Iniciando o servidor e o banco de dados.
cd /d "%~dp0"
:: Inicia o servidor em segundo plano
start /min node backend/server.js
:: Espera 3 segundos para o banco carregar
timeout /t 3
:: Abre o navegador automaticamente na tela do Caixa
start http://localhost:3000/caixa.html
exit