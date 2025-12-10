// Vercel Function: Stripe PaymentIntent作成（セキュリティ対策付き）
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 不審なIPアドレスの判定（簡易版）
function isSuspiciousIP(ip) {
    // VPN/プロキシの一般的なパターン（実際の運用ではより詳細な判定が必要）
    // 注意: 本番環境では専用のIP判定サービス（MaxMind GeoIP2など）の使用を推奨
    const suspiciousPatterns = [
        // Tor出口ノード（例）
        /^185\.220\./,
        /^199\.87\./,
    ];
    
    // ローカルホストやVercel内部IPは許可
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('172.16.')) {
        return false;
    }
    
    // パターンマッチング（実際の運用では外部サービスを使用）
    return suspiciousPatterns.some(pattern => pattern.test(ip));
}

// レート制限チェック（簡易版 - 実際の運用ではRedisなどの外部ストレージを使用）
// 注意: Vercel Functionsはステートレスなので、本番環境では外部ストレージが必要
const rateLimitStore = new Map();

function checkRateLimit(identifier, maxAttempts = 5, windowMs = 60 * 60 * 1000) {
    const now = Date.now();
    const key = identifier;
    
    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, { count: 0, resetAt: now + windowMs });
        return { allowed: true, remaining: maxAttempts - 1 };
    }
    
    const data = rateLimitStore.get(key);
    
    // ウィンドウがリセットされた場合
    if (now > data.resetAt) {
        data.count = 0;
        data.resetAt = now + windowMs;
    }
    
    if (data.count >= maxAttempts) {
        return { 
            allowed: false, 
            remaining: 0,
            resetAt: data.resetAt
        };
    }
    
    data.count++;
    return { 
        allowed: true, 
        remaining: maxAttempts - data.count 
    };
}

module.exports = async (req, res) => {
    // CORS設定
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    // OPTIONSリクエストの処理
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // POSTリクエストのみ許可
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // シークレットキーの存在確認
        if (!process.env.STRIPE_SECRET_KEY) {
            console.error('STRIPE_SECRET_KEY is not set');
            return res.status(500).json({ 
                error: 'Server configuration error',
                message: '決済システムの設定に問題があります。管理者にお問い合わせください。'
            });
        }

        // IPアドレスを取得（Vercel用）
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                        req.headers['x-vercel-forwarded-for']?.split(',')[0]?.trim() ||
                        req.headers['x-real-ip'] ||
                        req.connection?.remoteAddress ||
                        'unknown';

        // セキュリティチェック1: 不審なIPアドレスのチェック
        if (isSuspiciousIP(clientIP)) {
            console.warn(`Suspicious IP detected: ${clientIP}`);
            // 本番環境ではブロックするが、テスト環境では警告のみ
            // return res.status(403).json({ error: 'Access denied' });
        }

        // リクエストボディをパース
        const { email, amount, currency = 'jpy' } = req.body;

        // バリデーション
        if (!email || !amount) {
            return res.status(400).json({ 
                error: 'Invalid request',
                message: 'メールアドレスと金額が必要です。'
            });
        }

        // メールアドレスの形式チェック
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                error: 'Invalid email',
                message: '有効なメールアドレスを入力してください。'
            });
        }

        // 金額のバリデーション
        if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) {
            return res.status(400).json({ 
                error: 'Invalid amount',
                message: '金額が無効です。'
            });
        }

        // セキュリティチェック2: レート制限
        const emailLower = email.toLowerCase().trim();
        const rateLimit = checkRateLimit(`email:${emailLower}`, 5, 60 * 60 * 1000); // 1時間に5回まで
        
        if (!rateLimit.allowed) {
            const resetMinutes = Math.ceil((rateLimit.resetAt - Date.now()) / (60 * 1000));
            return res.status(429).json({ 
                error: 'Too many requests',
                message: `セキュリティのため、${resetMinutes}分後に再度お試しください。`
            });
        }

        // IPアドレスベースのレート制限もチェック
        const ipRateLimit = checkRateLimit(`ip:${clientIP}`, 10, 60 * 60 * 1000); // 1時間に10回まで
        
        if (!ipRateLimit.allowed) {
            return res.status(429).json({ 
                error: 'Too many requests',
                message: 'セキュリティのため、しばらく時間をおいてから再度お試しください。'
            });
        }

        // Stripe PaymentIntentを作成（EMV 3-D セキュアを有効化）
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
            metadata: {
                email: emailLower,
                client_ip: clientIP,
                timestamp: new Date().toISOString(),
            },
            // EMV 3-D セキュアを有効化
            payment_method_options: {
                card: {
                    request_three_d_secure: 'automatic',
                },
            },
        });

        console.log('✅ PaymentIntent created:', paymentIntent.id);

        return res.status(200).json({
            clientSecret: paymentIntent.client_secret,
            id: paymentIntent.id,
        });

    } catch (error) {
        console.error('❌ Error creating payment intent:', error);
        
        // Stripe APIエラーの詳細をログに記録
        if (error.type) {
            console.error('Stripe error type:', error.type);
            console.error('Stripe error code:', error.code);
            console.error('Stripe error message:', error.message);
        }
        
        // エラーの種類に応じたメッセージを返す
        let errorMessage = '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。';
        let statusCode = 500;
        
        if (error.type === 'StripeAuthenticationError') {
            errorMessage = '決済システムの認証に失敗しました。管理者にお問い合わせください。';
            statusCode = 500;
        } else if (error.type === 'StripeAPIError') {
            errorMessage = '決済システムとの通信に失敗しました。しばらく時間をおいてから再度お試しください。';
            statusCode = 502;
        } else if (error.type === 'StripeInvalidRequestError') {
            errorMessage = 'リクエストが無効です。入力内容をご確認ください。';
            statusCode = 400;
        }
        
        return res.status(statusCode).json({ 
            error: 'Internal server error',
            message: errorMessage
        });
    }
};

