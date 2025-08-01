// Vercel Serverless Function for Message Analysis

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { text } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ 
                error: 'メッセージテキストが必要です' 
            });
        }

        if (text.length > 500) {
            return res.status(400).json({ 
                error: 'メッセージは500文字以内で入力してください' 
            });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Gemini API key not configured');
        }

        // 改善APIと同じ方法を使用（直接fetch）
        const analysisPrompt = `
あなたはプロの恋愛コーチです。以下のメッセージを厳格に分析してください。

メッセージ: "${text}"

【重要】まず詳細分析を行い、その分析内容に基づいて点数を決定してください。

【採点方針】
詳細分析で以下の表現を使った場合は、それに見合ったパーセンテージを付けること：
- 「非常に高い不快リスク」「極めて不適切」 → 0-20%
- 「高い不快リスク」「不適切」 → 20-40%  
- 「中程度の問題」「注意が必要」 → 40-60%
- 「軽微な問題」「概ね問題ない」 → 60-80%
- 「適切」「問題なし」 → 80-100%

以下のJSON形式で厳格に採点してください：

{
  "overall_score": 全体的な品質評価(0-100点),
  "category_scores": {
    "impression": "印象評価: (0-100%)",
    "naturalness": "自然さ評価: (0-100%)", 
    "discomfort_risk": "不快リスク回避: (0-100%)",
    "continuity": "継続性評価: (0-100%)"
  },
  "detailed_feedback": {
    "impression": "印象についての具体的フィードバック",
    "naturalness": "自然さについての具体的フィードバック", 
    "discomfort_risk": "不快リスク回避についての具体的フィードバック",
    "continuity": "継続性についての具体的フィードバック"
  },
  "detected_issues": [
    "検出された具体的問題点"
  ],
  "improvement_suggestions": [
    "具体的改善提案1",
    "具体的改善提案2"
  ],
  "pro_tips": [
    "プロアドバイス"
  ],
  "grade": "評価ランク（S/A/B/C/D）",
  "summary": "評価要約"
}
`;

        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: analysisPrompt
                        }
                    ]
                }
            ]
        };

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('=== GEMINI API ERROR DETAILS ===');
            console.error('Status:', response.status);
            console.error('Error Body:', errorText);
            console.error('================================');
            throw new Error(`Gemini API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'テストレスポンス';
        
        console.log('Gemini API raw response:', analysisText);

        // JSON部分を抽出
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('有効なJSON形式の分析結果が取得できませんでした');
        }

        let analysisResult;
        try {
            analysisResult = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            console.error('JSON Parse Error:', parseError);
            console.error('Raw JSON string:', jsonMatch[0]);
            throw new Error('分析結果のJSONパースに失敗しました');
        }

        // データ検証
        if (!analysisResult.overall_score || !analysisResult.category_scores) {
            throw new Error('分析結果の形式が不正です');
        }

        // スコアの正規化（総合スコアのみ0-100の範囲に調整）
        analysisResult.overall_score = Math.max(0, Math.min(100, analysisResult.overall_score));

        // 成功レスポンス
        res.status(200).json({
            success: true,
            analysis: analysisResult,
            input_text: text
        });

    } catch (error) {
        console.error('=== ANALYSIS API ERROR DETAILS ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('API Key exists:', !!process.env.GEMINI_API_KEY);
        console.error('API Key length:', process.env.GEMINI_API_KEY?.length);
        console.error('=====================================');
        
        // エラーの詳細をログに記録
        if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('403')) {
            console.error('🚨 Gemini API Key is invalid or expired');
        } else if (error.message?.includes('QUOTA_EXCEEDED') || error.message?.includes('429')) {
            console.error('🚨 Gemini API quota exceeded or rate limited');
        } else if (error.message?.includes('Network')) {
            console.error('🚨 Network connection error');
        }

        res.status(500).json({ 
            success: false,
            error: 'メッセージ分析中にエラーが発生しました。もう一度お試しください。',
            details: error.message,
            errorType: error.message?.includes('403') ? 'API_KEY_ERROR' : 
                      error.message?.includes('429') ? 'QUOTA_ERROR' : 'UNKNOWN_ERROR'
        });
    }
}