const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'manual.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS defects (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, module TEXT NOT NULL, classification TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '', criteria TEXT NOT NULL DEFAULT '',
 disposition TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
 created_by INTEGER NOT NULL REFERENCES users(id), updated_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT, defect_id INTEGER NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
 uploaded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, defect_id INTEGER NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, snapshot TEXT NOT NULL, change_note TEXT NOT NULL DEFAULT '',
 changed_by INTEGER NOT NULL REFERENCES users(id), changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id INTEGER, details TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const modules = ['SMT', 'AOI', 'Manual de aceitação', 'Soldagem', 'Repair Center'];
const roles = ['admin','editor','viewer'];
const log = (uid, action, type, id, details='') => db.prepare(
 'INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)'
).run(uid || null, action, type, id || null, details);
const publicUser = u => ({id:u.id, username:u.username, displayName:u.display_name, role:u.role});
const requireAuth = (req,res,next) => req.session.user ? next() : res.status(401).json({error:'Faça login para continuar.'});
const requireRole = (...allowed) => (req,res,next) =>
 req.session.user && allowed.includes(req.session.user.role) ? next() : res.status(403).json({error:'Permissão insuficiente.'});
const upload = multer({
 storage: multer.diskStorage({
  destination: (req,file,cb) => cb(null, UPLOAD_DIR),
  filename: (req,file,cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
 }),
 limits: {fileSize: 5 * 1024 * 1024, files: 8},
 fileFilter: (req,file,cb) => {
  const ok = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype);
  cb(ok ? null : new Error('Formato inválido. Use JPG, PNG, WEBP ou GIF.'), ok);
 }
});
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({limit:'1mb'}));
app.use(session({
 secret: process.env.SESSION_SECRET || 'TROQUE-ESTE-SEGREDO-ANTES-DE-PUBLICAR',
 resave:false, saveUninitialized:false,
 cookie:{httpOnly:true, sameSite:'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8*60*60*1000}
}));
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname,'public')));

function ensureAdmin() {
 const username = process.env.ADMIN_USER;
 const password = process.env.ADMIN_PASSWORD;
 if (!username || !password) {
  console.warn('ATENÇÃO: defina ADMIN_USER e ADMIN_PASSWORD para criar o administrador inicial.');
  return;
 }
 const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
 if (!exists) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users(username,password_hash,display_name,role) VALUES(?,?,?,?)')
   .run(username, hash, 'Administrador', 'admin');
  console.log(`Administrador inicial criado: ${username}`);
 }
}
ensureAdmin();

app.get('/api/health', (req,res) => res.json({ok:true, service:'manual-digital-defeitos'}));
app.post('/api/login', (req,res) => {
 const {username,password} = req.body || {};
 if (!username || !password) return res.status(400).json({error:'Informe usuário e senha.'});
 const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username).trim());
 if (!u || !bcrypt.compareSync(String(password),u.password_hash)) {
  log(null,'login_failed','user',null,String(username).slice(0,80));
  return res.status(401).json({error:'Usuário ou senha inválidos.'});
 }
 req.session.regenerate(err => {
  if (err) return res.status(500).json({error:'Não foi possível iniciar a sessão.'});
  req.session.user = publicUser(u);
  log(u.id,'login','user',u.id);
  res.json({user:req.session.user});
 });
});
app.post('/api/logout', requireAuth, (req,res) => {
 log(req.session.user.id,'logout','user',req.session.user.id);
 req.session.destroy(()=>res.json({ok:true}));
});
app.get('/api/me', requireAuth, (req,res)=>res.json({user:req.session.user, modules}));
app.get('/api/users', requireAuth, requireRole('admin'), (req,res) =>
 res.json(db.prepare('SELECT id,username,display_name AS displayName,role,active,created_at AS createdAt FROM users ORDER BY username').all()));
app.post('/api/users', requireAuth, requireRole('admin'), (req,res) => {
 const {username,password,displayName,role} = req.body || {};
 if (!username || String(username).trim().length < 3 || !password || String(password).length < 10 || !displayName || !roles.includes(role))
  return res.status(400).json({error:'Informe usuário (mín. 3 caracteres), nome, papel válido e senha com pelo menos 10 caracteres.'});
 try {
  const result = db.prepare('INSERT INTO users(username,password_hash,display_name,role) VALUES(?,?,?,?)')
   .run(String(username).trim(),bcrypt.hashSync(String(password),12),String(displayName).trim(),role);
  log(req.session.user.id,'create','user',result.lastInsertRowid,role);
  res.status(201).json({id:result.lastInsertRowid});
 } catch(e) { res.status(409).json({error:'Usuário já existe ou os dados são inválidos.'}); }
});
app.patch('/api/users/:id', requireAuth, requireRole('admin'), (req,res) => {
 const id=Number(req.params.id), {role,active,password,displayName}=req.body||{};
 const target=db.prepare('SELECT * FROM users WHERE id=?').get(id);
 if(!target) return res.status(404).json({error:'Usuário não encontrado.'});
 if(id===req.session.user.id && active===false) return res.status(400).json({error:'Não é possível desativar sua própria conta.'});
 if(role!==undefined && !roles.includes(role)) return res.status(400).json({error:'Papel inválido.'});
 if(password!==undefined && String(password).length<10) return res.status(400).json({error:'A senha deve ter pelo menos 10 caracteres.'});
 db.prepare('UPDATE users SET role=COALESCE(?,role), active=COALESCE(?,active), display_name=COALESCE(?,display_name), password_hash=COALESCE(?,password_hash) WHERE id=?')
 .run(role??null,active===undefined?null:(active?1:0),displayName??null,password?bcrypt.hashSync(String(password),12):null,id);
 log(req.session.user.id,'update','user',id,'permissões/estado alterados');
 res.json({ok:true});
});

const defectSelect = `SELECT d.*, u.display_name AS createdByName, v.display_name AS updatedByName
 FROM defects d JOIN users u ON u.id=d.created_by JOIN users v ON v.id=d.updated_by`;
app.get('/api/defects', requireAuth, (req,res) => {
 const {q='',module='',classification='',status=''}=req.query;
 let sql=defectSelect+' WHERE 1=1', args=[];
 if(q){sql+=' AND (d.code LIKE ? OR d.title LIKE ? OR d.description LIKE ? OR d.criteria LIKE ?)'; const like='%'+String(q).slice(0,100)+'%'; args.push(like,like,like,like);}
 if(module && modules.includes(module)){sql+=' AND d.module=?';args.push(module);}
 if(classification){sql+=' AND d.classification=?';args.push(String(classification).slice(0,80));}
 if(status && ['draft','published','archived'].includes(status)){sql+=' AND d.status=?';args.push(status);}
 sql+=' ORDER BY d.updated_at DESC';
 const rows=db.prepare(sql).all(...args).map(d=>({...d, photos:db.prepare('SELECT id,original_name AS originalName,mime_type AS mimeType,size FROM photos WHERE defect_id=? ORDER BY id').all(d.id)}));
 res.json(rows);
});
app.get('/api/defects/:id', requireAuth, (req,res) => {
 const d=db.prepare(defectSelect+' WHERE d.id=?').get(Number(req.params.id));
 if(!d) return res.status(404).json({error:'Registro não encontrado.'});
 d.photos=db.prepare('SELECT id,original_name AS originalName,mime_type AS mimeType,size FROM photos WHERE defect_id=? ORDER BY id').all(d.id);
 d.revisions=db.prepare('SELECT r.id,r.revision,r.change_note AS changeNote,r.changed_at AS changedAt,u.display_name AS changedByName FROM revisions r JOIN users u ON u.id=r.changed_by WHERE r.defect_id=? ORDER BY r.revision DESC').all(d.id);
 res.json(d);
});
app.post('/api/defects', requireAuth, requireRole('admin','editor'), (req,res) => {
 const v=req.body||{};
 if(!v.code || !v.title || !modules.includes(v.module)) return res.status(400).json({error:'Código, título e módulo válido são obrigatórios.'});
 if(!['draft','published','archived'].includes(v.status||'draft')) return res.status(400).json({error:'Status inválido.'});
 const uid=req.session.user.id;
 try {
  const r=db.prepare(`INSERT INTO defects(code,title,module,classification,description,criteria,disposition,status,created_by,updated_by)
  VALUES(?,?,?,?,?,?,?,?,?,?)`).run(String(v.code).trim(),String(v.title).trim(),v.module,String(v.classification||''),String(v.description||''),String(v.criteria||''),String(v.disposition||''),v.status||'draft',uid,uid);
  const d=db.prepare('SELECT * FROM defects WHERE id=?').get(r.lastInsertRowid);
  db.prepare('INSERT INTO revisions(defect_id,revision,snapshot,change_note,changed_by) VALUES(?,?,?,?,?)')
   .run(d.id,1,JSON.stringify(d),'Cadastro inicial',uid);
  log(uid,'create','defect',d.id,d.code);
  res.status(201).json({id:d.id});
 } catch(e) {res.status(409).json({error:'Código já cadastrado ou dados inválidos.'});}
});
app.put('/api/defects/:id', requireAuth, requireRole('admin','editor'), (req,res) => {
 const id=Number(req.params.id), old=db.prepare('SELECT * FROM defects WHERE id=?').get(id);
 if(!old) return res.status(404).json({error:'Registro não encontrado.'});
 const v=req.body||{};
 if(!v.code || !v.title || !modules.includes(v.module)) return res.status(400).json({error:'Código, título e módulo válido são obrigatórios.'});
 if(!['draft','published','archived'].includes(v.status)) return res.status(400).json({error:'Status inválido.'});
 if(old.status==='published' && req.session.user.role!=='admin' && v.status==='archived') return res.status(403).json({error:'Somente administrador pode arquivar um registro publicado.'});
 const rev=old.revision+1, uid=req.session.user.id;
 try {
  db.prepare(`UPDATE defects SET code=?,title=?,module=?,classification=?,description=?,criteria=?,disposition=?,status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,revision=? WHERE id=?`)
   .run(String(v.code).trim(),String(v.title).trim(),v.module,String(v.classification||''),String(v.description||''),String(v.criteria||''),String(v.disposition||''),v.status,uid,rev,id);
  const d=db.prepare('SELECT * FROM defects WHERE id=?').get(id);
  db.prepare('INSERT INTO revisions(defect_id,revision,snapshot,change_note,changed_by) VALUES(?,?,?,?,?)')
   .run(id,rev,JSON.stringify(d),String(v.changeNote||'Atualização').slice(0,500),uid);
  log(uid,'update','defect',id,`revisão ${rev}`);
  res.json({ok:true,revision:rev});
 } catch(e) {res.status(409).json({error:'Código já utilizado ou dados inválidos.'});}
});
app.post('/api/defects/:id/photos', requireAuth, requireRole('admin','editor'), upload.array('photos',8), (req,res) => {
 const id=Number(req.params.id);
 if(!db.prepare('SELECT id FROM defects WHERE id=?').get(id)) {
  (req.files||[]).forEach(f=>fs.unlink(f.path,()=>{}));
  return res.status(404).json({error:'Registro não encontrado.'});
 }
 const add=db.prepare('INSERT INTO photos(defect_id,filename,original_name,mime_type,size,uploaded_by) VALUES(?,?,?,?,?,?)');
 const tx=db.transaction(files=>files.forEach(f=>add.run(id,f.filename,path.basename(f.originalname),f.mimetype,f.size,req.session.user.id)));
 tx(req.files||[]);
 log(req.session.user.id,'upload_photos','defect',id,`${(req.files||[]).length} arquivo(s)`);
 res.json({ok:true,count:(req.files||[]).length});
});
app.delete('/api/photos/:id', requireAuth, requireRole('admin','editor'), (req,res) => {
 const p=db.prepare('SELECT * FROM photos WHERE id=?').get(Number(req.params.id));
 if(!p) return res.status(404).json({error:'Foto não encontrada.'});
 db.prepare('DELETE FROM photos WHERE id=?').run(p.id);
 fs.unlink(path.join(UPLOAD_DIR,p.filename),()=>{});
 log(req.session.user.id,'delete_photo','photo',p.id);
 res.json({ok:true});
});
app.get('/api/photos/:id/file', requireAuth, (req,res) => {
 const p=db.prepare('SELECT * FROM photos WHERE id=?').get(Number(req.params.id));
 if(!p) return res.status(404).end();
 res.type(p.mime_type).sendFile(path.join(UPLOAD_DIR,p.filename));
});
app.get('/api/defects/:id/revisions/:revision', requireAuth, (req,res) => {
 const r=db.prepare('SELECT * FROM revisions WHERE defect_id=? AND revision=?').get(Number(req.params.id),Number(req.params.revision));
 if(!r) return res.status(404).json({error:'Revisão não encontrada.'});
 res.json({...r,snapshot:JSON.parse(r.snapshot)});
});
app.get('/api/audit', requireAuth, requireRole('admin'), (req,res) => res.json(db.prepare(`SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`).all()));
app.use((err,req,res,next) => {
 if(err instanceof multer.MulterError) return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Cada foto pode ter no máximo 5 MB.':'Limite de upload excedido.'});
 if(err) return res.status(400).json({error:err.message||'Requisição inválida.'});
 next();
});
app.listen(PORT,()=>console.log(`Manual Digital de Defeitos disponível em http://localhost:${PORT}`));
