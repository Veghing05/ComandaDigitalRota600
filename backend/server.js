const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());

// Serve os arquivos do Frontend na porta 3000
app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" } 
});

const db = new sqlite3.Database('./backend/database.sqlite', (err) => {
    if (err) console.error("Erro ao abrir banco:", err.message);
    else console.log('Banco de Dados SQLite: PRONTO');
});

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS mesas (id INTEGER PRIMARY KEY, status TEXT, consumo REAL)");
    db.run("CREATE TABLE IF NOT EXISTS produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, preco REAL, estoque INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS itens_pedido (id INTEGER PRIMARY KEY AUTOINCREMENT, mesa_id INTEGER, produto_nome TEXT, valor REAL)");

    db.get("SELECT COUNT(*) AS total FROM mesas", (err, row) => {
        if (row && row.total === 0) {
            const stmt = db.prepare("INSERT INTO mesas (id, status, consumo) VALUES (?, 'vazia', 0)");
            for (let i = 1; i <= 50; i++) stmt.run(i);
            stmt.finalize();
        }
    });
});

io.on('connection', (socket) => {
    console.log(`Conectado: ${socket.id}`);

    const atualizarTudo = () => {
        db.all("SELECT * FROM mesas", (err, rows) => io.emit('atualizarMesas', rows));
        db.all("SELECT * FROM produtos", (err, rows) => io.emit('atualizarProdutos', rows));
    };

    atualizarTudo();

    socket.on('getDetalhes', (mesaId) => {
        db.all("SELECT * FROM itens_pedido WHERE mesa_id = ?", [mesaId], (err, rows) => {
            socket.emit('detalhesMesa', { mesaId, itens: rows || [] });
        });
    });

    socket.on('lancarItem', ({ mesaId, nome, preco }) => {
        // Proteção: Não permite lançar se a mesa estiver em fechamento (vermelha)
        db.get("SELECT status FROM mesas WHERE id = ?", [mesaId], (err, row) => {
            if (row && row.status === 'fechada') return;

            db.run("INSERT INTO itens_pedido (mesa_id, produto_nome, valor) VALUES (?, ?, ?)", [mesaId, nome, preco], () => {
                db.run(`
                    UPDATE mesas 
                    SET status = 'consumindo', 
                    consumo = (SELECT SUM(valor) FROM itens_pedido WHERE mesa_id = ?) 
                    WHERE id = ?`, [mesaId, mesaId], () => {
                    
                    atualizarTudo();
                    db.all("SELECT * FROM itens_pedido WHERE mesa_id = ?", [mesaId], (err, rows) => {
                        io.emit('detalhesMesa', { mesaId, itens: rows });
                    });
                });
            });
        });
    });

    socket.on('criarProduto', (p) => {
        db.run("INSERT INTO produtos (nome, preco, estoque) VALUES (?, ?, ?)", [p.nome, p.preco, p.estoque], atualizarTudo);
    });

    socket.on('alterarStatus', ({ id, status }) => {
        if (status === 'vazia') {
            // Ação do CAIXA: Limpa tudo (Azul)
            db.run("DELETE FROM itens_pedido WHERE mesa_id = ?", [id], () => {
                db.run("UPDATE mesas SET status = 'vazia', consumo = 0 WHERE id = ?", [id], atualizarTudo);
            });
        } else {
            // Ação do GARÇOM ou CAIXA: Solicitar conta (Vermelho)
            db.run("UPDATE mesas SET status = ? WHERE id = ?", [status, id], atualizarTudo);
        }
    });

    socket.on('disconnect', () => console.log('Desconectado.'));
});

const PORTA = 3000;
server.listen(PORTA, '0.0.0.0', () => {
    console.log('-------------------------------------------');
    console.log('       SISTEMA ROTA 600 - ONLINE           ');
    console.log(` ACESSO: http://192.168.0.149:${PORTA}      `);
    console.log('-------------------------------------------');
});