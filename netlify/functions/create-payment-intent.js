// Netlify Function: Stripe PaymentIntent作成（セキュリティ対策付き）
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
    
    // ローカルホストやNetlify内部IPは許可
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('172.16.')) {
        return false;
    }
    
    // パターンマッチング（実際の運用では外部サービスを使用）
    return suspiciousPatterns.some(pattern => pattern.test(ip));
}

// レート制限チェック（簡易版 - 実際の運用ではRedisなどの外部ストレージを使用）
// 注意: Netlify Functionsはステートレスなので、本番環境では外部ストレージが必要
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

exports.handler = async (event, context) => {
    // CORS設定
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    };

    // OPTIONSリクエストの処理
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: '',
        };
    }

    // POSTリクエストのみ許可
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }

    try {
        // IPアドレスを取得
        const clientIP = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                        event.headers['x-nf-client-connection-ip'] || 
                        event.requestContext?.identity?.sourceIp || 
                        'unknown';

        // セキュリティチェック1: 不審なIPアドレスのチェック
        if (isSuspiciousIP(clientIP)) {
            console.warn(`Suspicious IP detected: ${clientIP}`);
            // 本番環境ではブロックするが、テスト環境では警告のみ
            // return {
            //     statusCode: 403,
            //     headers,
            //     body: JSON.stringify({ error: 'Access denied' }),
            // };
        }

        // リクエストボディをパース
        const { email, amount, currency = 'jpy' } = JSON.parse(event.body || '{}');

        if (!email || !amount) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request' }),
            };
        }

        // セキュリティチェック2: レート制限
        const emailLower = email.toLowerCase().trim();
        const rateLimit = checkRateLimit(`email:${emailLower}`, 5, 60 * 60 * 1000); // 1時間に5回まで
        
        if (!rateLimit.allowed) {
            const resetMinutes = Math.ceil((rateLimit.resetAt - Date.now()) / (60 * 1000));
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ 
                    error: 'Too many requests',
                    message: `セキュリティのため、${resetMinutes}分後に再度お試しください。`
                }),
            };
        }

        // IPアドレスベースのレート制限もチェック
        const ipRateLimit = checkRateLimit(`ip:${clientIP}`, 10, 60 * 60 * 1000); // 1時間に10回まで
        
        if (!ipRateLimit.allowed) {
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ 
                    error: 'Too many requests',
                    message: 'セキュリティのため、しばらく時間をおいてから再度お試しください。'
                }),
            };
        }

        // Stripe PaymentIntentを作成（EMV 3-D セキュアを有効化）
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
            metadata: {
                email: emailLower,
                client_ip: clientIP,
            },
            // EMV 3-D セキュアを有効化
            payment_method_options: {
                card: {
                    request_three_d_secure: 'automatic',
                },
            },
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                clientSecret: paymentIntent.client_secret,
                id: paymentIntent.id,
            }),
        };

    } catch (error) {
        console.error('Error creating payment intent:', error);
        
        // エラー内容を非表示（セキュリティ対策）
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: '処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。'
            }),
        };
    }
};

