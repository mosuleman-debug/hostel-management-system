require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware Framework Configuration
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Express Session Management Setup
app.use(session({
    secret: 'hostel_super_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

// View Engine Setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed: ' + err.stack);
        return;
    }
    console.log('✅ Connected to MySQL Database.');
    createTables();
});

// Automatic Tables & Seed Default Admin Layout
function createTables() {
    const roomsTable = `
        CREATE TABLE IF NOT EXISTS rooms (
            id INT AUTO_INCREMENT PRIMARY KEY,
            room_no VARCHAR(10) NOT NULL UNIQUE,
            capacity INT NOT NULL,
            allocated INT DEFAULT 0
        );
    `;

    const studentsTable = `
        CREATE TABLE IF NOT EXISTS students (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            roll_no VARCHAR(50) NOT NULL UNIQUE,
            mobile VARCHAR(15) NOT NULL,
            address TEXT NOT NULL,
            room_id INT,
            fee_status ENUM('Paid', 'Pending') DEFAULT 'Pending',
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
        );
    `;

    const adminTable = `
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            password VARCHAR(100) NOT NULL
        );
    `;

    db.query(roomsTable);
    db.query(studentsTable);
    db.query(adminTable, (err) => {
        if (!err) {
            db.query('SELECT * FROM admins WHERE username = "admin"', (err, rows) => {
                if (rows && rows.length === 0) {
                    db.query('INSERT INTO admins (username, password) VALUES ("admin", "admin123")');
                    console.log('🔷 Default Admin Seeded -> User: admin | Pass: admin123');
                }
            });
        }
    });
}

// 🔐 SECURITY MIDDLEWARE: Check user is logged in
const isAdminAuthenticated = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.redirect('/login');
    }
};

// ========== SYSTEM CONTROL ENDPOINTS ==========

app.get('/login', (req, res) => {
    if (req.session.isAdmin) return res.redirect('/');
    res.render('login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM admins WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (err) return res.render('login', { error: 'Database Internal Error' });
        if (results.length > 0) {
            req.session.isAdmin = true;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Invalid Username or Password!' });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// 📊 Protected Dashboard Router (Updated with Revenue calculation)
app.get('/', isAdminAuthenticated, (req, res) => {
    db.query('SELECT * FROM rooms', (err, rooms) => {
        if (err) return res.send(err);
        
        db.query('SELECT s.*, r.room_no FROM students s LEFT JOIN rooms r ON s.room_id = r.id', (err, students) => {
            if (err) return res.send(err);

            // Calculate Revenue (Let's assume standard hostel rent is ₹5000 per student)
            const rentPerStudent = 5000;
            let totalPaidRevenue = 0;
            students.forEach(s => {
                if(s.fee_status === 'Paid') totalPaidRevenue += rentPerStudent;
            });

            res.render('dashboard', { 
                rooms: rooms, 
                students: students,
                totalPaidRevenue: totalPaidRevenue
            });
        });
    });
});

app.get('/rooms', isAdminAuthenticated, (req, res) => {
    db.query('SELECT * FROM rooms', (err, rooms) => {
        res.render('rooms', { rooms: rooms });
    });
});

app.get('/students', isAdminAuthenticated, (req, res) => {
    db.query('SELECT s.*, r.room_no FROM students s LEFT JOIN rooms r ON s.room_id = r.id', (err, students) => {
        res.render('students', { students: students });
    });
});

app.post('/add-room', isAdminAuthenticated, (req, res) => {
    const { room_no, capacity } = req.body;
    db.query('INSERT INTO rooms (room_no, capacity) VALUES (?, ?)', [room_no, capacity], (err) => {
        res.redirect('/');
    });
});

app.post('/add-student', isAdminAuthenticated, (req, res) => {
    const { name, roll_no, mobile, address, room_id, fee_status } = req.body;
    db.query('SELECT capacity, allocated FROM rooms WHERE id = ?', [room_id], (err, result) => {
        if (result.length === 0 || result[0].allocated >= result[0].capacity) return res.send("Room space constraint fail!");
        
        const insertStudent = 'INSERT INTO students (name, roll_no, mobile, address, room_id, fee_status) VALUES (?, ?, ?, ?, ?, ?)';
        db.query(insertStudent, [name, roll_no, mobile, address, room_id, fee_status], (err) => {
            if (err) return res.send("Insertion Fail (Duplicate entry found)");
            db.query('UPDATE rooms SET allocated = allocated + 1 WHERE id = ?', [room_id], () => {
                res.redirect('/');
            });
        });
    });
});

app.post('/update-fee/:id', isAdminAuthenticated, (req, res) => {
    db.query("UPDATE students SET fee_status = 'Paid' WHERE id = ?", [req.params.id], () => {
        res.redirect('/');
    });
});

app.post('/checkout-student/:id', isAdminAuthenticated, (req, res) => {
    const { room_id } = req.body;
    db.query('DELETE FROM students WHERE id = ?', [req.params.id], () => {
        if (room_id) {
            db.query('UPDATE rooms SET allocated = allocated - 1 WHERE id = ? AND allocated > 0', [room_id], () => {
                res.redirect('/');
            });
        } else {
            res.redirect('/');
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Secure Analytics Server running on http://localhost:${PORT}`);
});