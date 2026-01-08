const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const db = new sqlite3.Database('./backend/database.sqlite');

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, preco REAL, estoque INTEGER, categoria TEXT, congelado INTEGER DEFAULT 0)");
    db.run("CREATE TABLE IF NOT EXISTS itens_pedido (id INTEGER PRIMARY KEY AUTOINCREMENT, mesa_id INTEGER, produto_nome TEXT, valor REAL, qtd INTEGER, obs TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS vendas_dia (id INTEGER PRIMARY KEY AUTOINCREMENT, total REAL, metodo_pagamento TEXT, data TEXT, hora TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS mesas (id INTEGER PRIMARY KEY, status TEXT, consumo REAL)");

    db.get("SELECT COUNT(*) AS total FROM mesas", (err, row) => {
        if (!row || row.total < 50) {
            const stmt = db.prepare("INSERT OR IGNORE INTO mesas (id, status, consumo) VALUES (?, 'vazia', 0)");
            for (let i = 1; i <= 50; i++) stmt.run(i);
            stmt.finalize(() => atualizarTudo());
        }
    });
});

const atualizarTudo = () => {
    db.all("SELECT * FROM mesas ORDER BY id ASC", (err, mesas) => io.emit('atualizarMesas', mesas || []));
    db.all("SELECT * FROM produtos ORDER BY nome ASC", (err, prods) => io.emit('atualizarProdutos', prods || []));
    const hoje = new Date().toISOString().split('T')[0];
    db.get("SELECT SUM(total) AS totalDia FROM vendas_dia WHERE data = ?", [hoje], (err, row) => {
        io.emit('faturamentoDia', row ? (row.totalDia || 0) : 0);
    });
};

io.on('connection', (socket) => {
    atualizarTudo();

    socket.on('solicitarItensMesa', (mesaId) => {
        db.all("SELECT * FROM itens_pedido WHERE mesa_id = ?", [mesaId], (err, rows) => {
            socket.emit('itensMesa', { mesaId, itens: rows || [] });
        });
    });

    socket.on('lancarItem', ({ mesaId, nome, preco, qtd, obs }) => {
        db.run("INSERT INTO itens_pedido (mesa_id, produto_nome, valor, qtd, obs) VALUES (?, ?, ?, ?, ?)", 
        [mesaId, nome, (preco * qtd), qtd, obs], () => {
            db.run("UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE nome = ? AND congelado = 0", [qtd, nome], () => {
                db.run("UPDATE mesas SET status = 'consumindo', consumo = (SELECT SUM(valor) FROM itens_pedido WHERE mesa_id = ?) WHERE id = ?", [mesaId, mesaId], () => {
                    atualizarTudo();
                    db.all("SELECT * FROM itens_pedido WHERE mesa_id = ?", [mesaId], (err, rows) => {
                        io.emit('itensMesa', { mesaId, itens: rows || [] });
                    });
                });
            });
        });
    });

    socket.on('pedirFechamento', (mesaId) => {
        db.run("UPDATE mesas SET status = 'fechamento' WHERE id = ?", [mesaId], atualizarTudo);
    });

    socket.on('removerItemComanda', ({ id, mesaId }) => {
        db.run("DELETE FROM itens_pedido WHERE id = ?", [id], () => {
            db.run("UPDATE mesas SET consumo = IFNULL((SELECT SUM(valor) FROM itens_pedido WHERE mesa_id = ?), 0) WHERE id = ?", [mesaId, mesaId], () => {
                db.get("SELECT consumo FROM mesas WHERE id = ?", [mesaId], (err, row) => {
                    if (row && row.consumo === 0) db.run("UPDATE mesas SET status = 'vazia' WHERE id = ?", [mesaId]);
                    atualizarTudo();
                    db.all("SELECT * FROM itens_pedido WHERE mesa_id = ?", [mesaId], (err, rows) => {
                        io.emit('itensMesa', { mesaId, itens: rows || [] });
                    });
                });
            });
        });
    });

    socket.on('salvarProduto', (p) => {
        const sql = p.id ? "UPDATE produtos SET nome=?, preco=?, estoque=?, categoria=? WHERE id=?" : "INSERT INTO produtos (nome, preco, estoque, categoria) VALUES (?,?,?,?)";
        const params = p.id ? [p.nome, p.preco, p.estoque, p.categoria, p.id] : [p.nome, p.preco, p.estoque, p.categoria];
        db.run(sql, params, atualizarTudo);
    });

    socket.on('finalizarConta', ({ mesaId, total, metodo }) => {
        const data = new Date().toISOString().split('T')[0], hora = new Date().toLocaleTimeString();
        db.run("INSERT INTO vendas_dia (total, metodo_pagamento, data, hora) VALUES (?, ?, ?, ?)", [total, metodo, data, hora], () => {
            db.run("DELETE FROM itens_pedido WHERE mesa_id = ?", [mesaId], () => {
                db.run("UPDATE mesas SET status = 'vazia', consumo = 0 WHERE id = ?", [mesaId], () => {
                    atualizarTudo();
                    io.emit('itensMesa', { mesaId, itens: [] });
                });
            });
        });
    });
});

server.listen(3000, '0.0.0.0', () => console.log("SISTEMA ROTA 600 ATIVO"));