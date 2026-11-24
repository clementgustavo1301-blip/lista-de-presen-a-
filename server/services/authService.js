const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ecoclinic-jwt-super-secret-key-2026';
const TOKEN_EXPIRATION = '12h';

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(senha, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verificarSenha(senha, senhaArmazenada) {
  if (!senhaArmazenada || typeof senhaArmazenada !== 'string' || !senhaArmazenada.includes(':')) {
    return false;
  }
  const [salt, hashOriginal] = senhaArmazenada.split(':');
  const hashVerificar = crypto.pbkdf2Sync(senha, salt, 10000, 64, 'sha512').toString('hex');
  return hashOriginal === hashVerificar;
}

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      cargo: usuario.cargo,
      registro_conselho: usuario.registro_conselho
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRATION }
  );
}

function verificarToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Middleware de autenticação obrigatória para as rotas protegidas
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login para continuar.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verificarToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  }

  req.user = decoded;
  next();
}

// Middleware para autorização baseada em cargos (RBAC)
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    if (rolesPermitidos.length > 0 && !rolesPermitidos.includes(req.user.cargo) && req.user.cargo !== 'administrador') {
      return res.status(403).json({ error: 'Você não tem permissão para realizar esta ação.' });
    }
    next();
  };
}

module.exports = {
  hashSenha,
  verificarSenha,
  gerarToken,
  verificarToken,
  requireAuth,
  requireRole
};

