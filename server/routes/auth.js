const express = require('express');
const router = express.Router();
const db = require('../db');
const authService = require('../services/authService');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    const emailLimpo = String(email).toLowerCase().trim();
    const user = await db.get('SELECT * FROM usuarios WHERE LOWER(email) = ? AND ativo = TRUE', [emailLimpo]);

    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const senhaValida = authService.verificarSenha(senha, user.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const token = authService.gerarToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        cargo: user.cargo,
        registro_conselho: user.registro_conselho
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao processar login.' });
  }
});

// GET /api/auth/me - Dados do usuário atualmente logado
router.get('/me', authService.requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, nome, email, cargo, registro_conselho FROM usuarios WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Erro em /me:', error);
    res.status(500).json({ error: 'Erro ao verificar sessão.' });
  }
});

// GET /api/auth/usuarios - Listar equipe (apenas administradores)
router.get('/usuarios', authService.requireAuth, authService.requireRole('administrador'), async (req, res) => {
  try {
    const users = await db.query('SELECT id, nome, email, cargo, registro_conselho, ativo, created_at FROM usuarios ORDER BY nome ASC');
    res.json(users);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar profissionais.' });
  }
});

module.exports = router;

