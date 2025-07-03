const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Claude API configuration
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || 'sk-ant-api03-qyOfH9cEEenSKtDIzJ6_4w15Ww0bT4ONy0MBcw73H6XF9o-jut0ZG-IwCy9DUaxGL5h4XFRinkv2rleII7ZN3g-29EkZQAA';

// In-memory storage for catalog data (you can replace with a database later)
const catalogStorage = new Map();

// Jewelry analysis prompt
const JEWELRY_ANALYSIS_PROMPT = `You are an expert jewelry cataloger with 20+ years of experience. Your task is to analyze jewelry images with EXTREME PRECISION for a searchable catalog.

CRITICAL RULES FOR ACCURACY:

1. PRIMARY CATEGORY - Must be ONE of these ONLY:
   - "ring" - Any finger jewelry
   - "earring" - Any ear jewelry  
   - "necklace" - Neck jewelry with chain
   - "pendant" - Hanging ornament (often on necklace)
   - "bracelet" - Wrist jewelry
   - "brooch" - Pin-style jewelry
   - "anklet" - Ankle jewelry

2. RING TYPES (if category is "ring"):
   - "solitaire" - ONLY ONE prominent center stone, no other stones
   - "halo" - Center stone surrounded by smaller stones
   - "three-stone" - Exactly 3 prominent stones
   - "eternity" - Continuous stones around entire band
   - "band" - Plain metal or small stones in rows
   - "cocktail" - Large decorative multi-stone design
   - "cluster" - Multiple stones grouped together

3. STRICT TAGGING RULES:
   - DO NOT tag "solitaire" if there are multiple rows of stones
   - DO NOT tag "solitaire" if there's a halo or side stones
   - Be specific about metal colors: "yellow-gold", "white-gold", "rose-gold", "platinum", "silver"
   - Include stone types: "diamond", "ruby", "emerald", "sapphire", "pearl"
   - Note settings: "prong", "bezel", "channel", "pave"

4. SEARCH OPTIMIZATION:
   - Think: "What would customers search for?"
   - Include both technical and common terms
   - Add style descriptors: "vintage", "modern", "classic", "art-deco"

Return ONLY a JSON object in this exact format:
{
  "category": "exact_category_from_list",
  "tags": ["specific", "searchable", "terms", "no-duplicates"],
  "description": "Brief 10-15 word description focusing on key features"
}`;

// Analyze jewelry image endpoint
app.post('/api/analyze-jewelry', async (req, res) => {
  try {
    const { imageUrl, imageName, userId } = req.body;

    if (!imageUrl || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    console.log(`Analyzing ${imageName} for user ${userId}`);
    console.log(`Image URL: ${imageUrl}`);

    // First, fetch the image from Firebase and convert to base64
    let base64Image;
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }
      const imageBuffer = await imageResponse.buffer();
      base64Image = imageBuffer.toString('base64');
      console.log('Successfully fetched and converted image to base64');
    } catch (fetchError) {
      console.error('Error fetching image from Firebase:', fetchError);
      return res.status(400).json({
        success: false,
        error: 'Unable to fetch image from Firebase. Please ensure the image URL is publicly accessible.'
      });
    }

    // Call Claude API with base64 image
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this jewelry image named "${imageName}":\n\n${JEWELRY_ANALYSIS_PROMPT}`
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Parse Claude's response
    const content = data.content[0].text;
    let result;
    
    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Parse error:', parseError);
      // Fallback parsing
      result = {
        category: 'unknown',
        tags: ['jewelry', imageName.split('.')[0]],
        description: 'Jewelry item'
      };
    }

    // Ensure tags are unique and lowercase
    result.tags = [...new Set(result.tags.map(tag => tag.toLowerCase()))];

    res.json({
      success: true,
      category: result.category,
      tags: result.tags,
      description: result.description
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Analysis failed' 
    });
  }
});

// Publish catalog endpoint
app.post('/api/publish-catalog', async (req, res) => {
  try {
    const { userId, catalog, totalImages, analyzedImages, publishedAt, folderInfo } = req.body;

    if (!userId || !catalog) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    // Store catalog data
    catalogStorage.set(userId, {
      catalog,
      totalImages,
      analyzedImages,
      publishedAt,
      folderInfo,
      lastUpdated: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Catalog published successfully',
      itemCount: catalog.length
    });

  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Publishing failed' 
    });
  }
});

// Get catalog tags endpoint
app.get('/api/catalog-tags', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId' 
      });
    }

    const catalogData = catalogStorage.get(userId);

    if (!catalogData) {
      return res.status(404).json({ 
        success: false, 
        error: 'No catalog found for user' 
      });
    }

    res.json({
      success: true,
      data: catalogData
    });

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Fetch failed' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    catalogCount: catalogStorage.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'JewelRender Claude API',
    endpoints: {
      analyze: 'POST /api/analyze-jewelry',
      publish: 'POST /api/publish-catalog',
      getTags: 'GET /api/catalog-tags',
      health: 'GET /health'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Claude API Key: ${CLAUDE_API_KEY ? 'Configured' : 'Missing'}`);
});