const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for rate limiting in production environments
app.set('trust proxy', 1);

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5000', 'http://127.0.0.1:5000'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const emailSignupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 email signups per windowMs
    message: {
        error: 'Too many email signup attempts, please try again later.',
        retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);

// Serve static files
app.use(express.static('./', {
    index: 'index.html',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Database initialization
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_subscribers (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                ip_address INET,
                user_agent TEXT,
                is_active BOOLEAN DEFAULT true,
                confirmed BOOLEAN DEFAULT false,
                confirmation_token VARCHAR(255),
                unsubscribe_token VARCHAR(255) UNIQUE DEFAULT gen_random_uuid()
            );
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_email_subscribers_email ON email_subscribers(email);
            CREATE INDEX IF NOT EXISTS idx_email_subscribers_active ON email_subscribers(is_active);
            CREATE INDEX IF NOT EXISTS idx_email_subscribers_confirmed ON email_subscribers(confirmed);
        `);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Utility functions
function sanitizeEmail(email) {
    return validator.escape(email.toLowerCase().trim());
}

function validateEmail(email) {
    return validator.isEmail(email) && email.length <= 255;
}

// API Routes

// Email subscription endpoint
app.post('/api/subscribe', emailSignupLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email address is required.'
            });
        }

        const sanitizedEmail = sanitizeEmail(email);

        if (!validateEmail(sanitizedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.'
            });
        }

        // Check if email already exists
        const existingSubscriber = await pool.query(
            'SELECT id, is_active FROM email_subscribers WHERE email = $1',
            [sanitizedEmail]
        );

        if (existingSubscriber.rows.length > 0) {
            if (existingSubscriber.rows[0].is_active) {
                return res.status(409).json({
                    success: false,
                    message: 'This email is already subscribed to our newsletter.'
                });
            } else {
                // Reactivate previously unsubscribed email
                await pool.query(
                    'UPDATE email_subscribers SET is_active = true, subscribed_at = CURRENT_TIMESTAMP WHERE email = $1',
                    [sanitizedEmail]
                );

                return res.status(200).json({
                    success: true,
                    message: 'Welcome back! You\'ve been resubscribed to our newsletter.'
                });
            }
        }

        // Add new subscriber
        const confirmationToken = require('crypto').randomBytes(32).toString('hex');
        
        await pool.query(`
            INSERT INTO email_subscribers (email, ip_address, user_agent, confirmation_token)
            VALUES ($1, $2, $3, $4)
        `, [
            sanitizedEmail,
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || 'Unknown',
            confirmationToken
        ]);

        // Log successful subscription
        console.log(`New email subscription: ${sanitizedEmail} from IP: ${req.ip}`);

        res.status(201).json({
            success: true,
            message: 'Thank you! You\'ll be notified when Auravia launches.'
        });

    } catch (error) {
        console.error('Subscription error:', error);
        
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({
                success: false,
                message: 'This email is already subscribed.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again later.'
        });
    }
});

// Get subscription stats (admin endpoint)
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_subscribers,
                COUNT(*) FILTER (WHERE is_active = true) as active_subscribers,
                COUNT(*) FILTER (WHERE confirmed = true) as confirmed_subscribers,
                COUNT(*) FILTER (WHERE subscribed_at >= CURRENT_DATE) as today_signups,
                COUNT(*) FILTER (WHERE subscribed_at >= CURRENT_DATE - INTERVAL '7 days') as week_signups,
                COUNT(*) FILTER (WHERE subscribed_at >= CURRENT_DATE - INTERVAL '30 days') as month_signups
            FROM email_subscribers
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to fetch statistics.'
        });
    }
});

// Export subscribers (admin endpoint)
app.get('/api/export', async (req, res) => {
    try {
        const subscribers = await pool.query(`
            SELECT email, subscribed_at, is_active, confirmed
            FROM email_subscribers
            WHERE is_active = true
            ORDER BY subscribed_at DESC
        `);

        res.json({
            success: true,
            data: subscribers.rows,
            count: subscribers.rows.length
        });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to export subscribers.'
        });
    }
});

// Unsubscribe endpoint
app.get('/api/unsubscribe/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const result = await pool.query(
            'UPDATE email_subscribers SET is_active = false WHERE unsubscribe_token = $1 RETURNING email',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(404).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h2>Invalid Unsubscribe Link</h2>
                        <p>This unsubscribe link is invalid or has already been used.</p>
                    </body>
                </html>
            `);
        }

        res.send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Successfully Unsubscribed</h2>
                    <p>You have been successfully unsubscribed from Auravia's newsletter.</p>
                    <p>We're sorry to see you go!</p>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Error</h2>
                    <p>Something went wrong. Please try again later.</p>
                </body>
            </html>
        `);
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            success: true,
            message: 'Server and database are healthy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            message: 'Database connection failed'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Gracefully shutting down...');
    await pool.end();
    process.exit(0);
});

// Start server
async function startServer() {
    await initializeDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Auravia Coming Soon server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

startServer().catch(console.error);