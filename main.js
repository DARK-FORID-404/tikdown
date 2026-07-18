// ============================================================
// TIKTOK DOWNLOADER - SIMPLIFIED & WORKING
// ============================================================

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    const tiktokUrl = url.searchParams.get('url');

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // If no URL, show error
    if (!tiktokUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing ?url parameter' }),
        { 
          status: 400, 
          headers: { 'Content-Type': 'application/json', ...corsHeaders } 
        }
      );
    }

    console.log('📥 Fetching:', tiktokUrl);

    // -------- STEP 1: Get REAL video data from TikTok --------
    const videoData = await getTikTokVideo(tiktokUrl);

    if (!videoData) {
      throw new Error('Could not get video data');
    }

    console.log('✅ Video found:', videoData.title);

    // -------- STEP 2: Build response --------
    const responsePayload = {
      success: true,
      video_id: videoData.id,
      title: videoData.title || 'No title',
      username: videoData.author || 'unknown',
      nickname: videoData.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.audio || '',
      video_url: videoData.videoUrl || '',
      download_url: videoData.videoUrl ? videoData.videoUrl + '&download=true' : '',
      width: 1080,
      height: 1920,
      created_at: Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.plays || 0,
        like_count: videoData.likes || 0,
        comment_count: videoData.comments || 0,
        share_count: videoData.shares || 0,
      },
    };

    return new Response(
      JSON.stringify(responsePayload, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          ...corsHeaders,
        },
      }
    );

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
        stack: error.stack,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

// ============================================================
// MAIN FUNCTION: Get REAL TikTok Video Data
// ============================================================

async function getTikTokVideo(inputUrl) {
  // -------- Step 1: Clean the URL --------
  let cleanUrl = inputUrl.split('?')[0];
  
  // Handle short links (vm.tiktok.com)
  if (cleanUrl.includes('vm.tiktok.com') || cleanUrl.includes('vt.tiktoklite.com')) {
    const response = await fetch(cleanUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    cleanUrl = response.url;
  }

  console.log('🌐 Resolved URL:', cleanUrl);

  // -------- Step 2: Extract video ID --------
  const videoId = extractVideoId(cleanUrl);
  if (!videoId) {
    throw new Error('Could not extract video ID');
  }

  console.log('🎬 Video ID:', videoId);

  // -------- Step 3: Fetch TikTok page --------
  const html = await fetchPage(cleanUrl);
  if (!html) {
    throw new Error('Failed to fetch TikTok page');
  }

  // -------- Step 4: Extract data from HTML --------
  const data = extractData(html, videoId);
  if (!data) {
    throw new Error('Could not extract video data');
  }

  return data;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function extractVideoId(url) {
  // Try different patterns
  const patterns = [
    /\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /(\d{19})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.log('❌ Page fetch failed:', response.status);
      return null;
    }

    return await response.text();
  } catch (error) {
    console.log('❌ Fetch error:', error.message);
    return null;
  }
}

function extractData(html, videoId) {
  try {
    // -------- METHOD 1: Find SIGI_STATE --------
    const sigiMatch = html.match(/window\.SIGI_STATE\s*=\s*({.*?});/s);
    if (sigiMatch) {
      const data = JSON.parse(sigiMatch[1]);
      const result = parseSigiData(data, videoId);
      if (result) return result;
    }

    // -------- METHOD 2: Find ItemModule --------
    const itemMatch = html.match(/"ItemModule":\s*({[^}]*})/s);
    if (itemMatch) {
      try {
        const items = JSON.parse(itemMatch[1]);
        const keys = Object.keys(items);
        if (keys.length > 0) {
          const item = items[keys[0]];
          return parseItem(item, videoId);
        }
      } catch (e) {}
    }

    // -------- METHOD 3: Regex fallback --------
    return extractWithRegex(html, videoId);

  } catch (error) {
    console.log('❌ Extract error:', error.message);
    return null;
  }
}

function parseSigiData(data, videoId) {
  try {
    let itemData = null;

    // Find ItemModule
    if (data.ItemModule) {
      const keys = Object.keys(data.ItemModule);
      if (keys.length > 0) {
        itemData = data.ItemModule[keys[0]];
      }
    }

    if (!itemData) return null;
    return parseItem(itemData, videoId);

  } catch (error) {
    return null;
  }
}

function parseItem(item, videoId) {
  try {
    // Get video URL (remove watermark)
    let videoUrl = '';
    if (item.video?.playAddr) {
      videoUrl = item.video.playAddr;
    } else if (item.video?.downloadAddr) {
      videoUrl = item.video.downloadAddr;
    } else if (item.playAddr) {
      videoUrl = item.playAddr;
    }

    // Remove watermark from URL
    if (videoUrl) {
      videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
      videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
    }

    // Get author
    const author = item.author || {};
    const stats = item.stats || {};

    return {
      id: item.id || videoId,
      title: item.desc || item.title || 'No title',
      description: item.desc || '',
      author: author.uniqueId || author.username || 'unknown',
      nickname: author.nickname || author.name || '',
      duration: parseInt(item.duration || 0),
      cover: item.cover || item.originCover || '',
      audio: item.music?.playUrl || '',
      videoUrl: videoUrl || '',
      plays: parseInt(stats.playCount || item.playCount || 0),
      likes: parseInt(stats.diggCount || item.diggCount || 0),
      comments: parseInt(stats.commentCount || item.commentCount || 0),
      shares: parseInt(stats.shareCount || item.shareCount || 0),
    };

  } catch (error) {
    return null;
  }
}

function extractWithRegex(html, videoId) {
  try {
    // Extract title
    let title = 'No title';
    const titleMatch = html.match(/"desc":"([^"]+)"/);
    if (titleMatch) {
      title = titleMatch[1];
    }

    // Extract author
    let author = 'unknown';
    const authorMatch = html.match(/"uniqueId":"([^"]+)"/);
    if (authorMatch) {
      author = authorMatch[1];
    }

    // Extract stats
    let plays = 0, likes = 0, comments = 0, shares = 0;
    
    const playMatch = html.match(/"playCount":(\d+)/);
    if (playMatch) plays = parseInt(playMatch[1]);

    const likeMatch = html.match(/"diggCount":(\d+)/);
    if (likeMatch) likes = parseInt(likeMatch[1]);

    const commentMatch = html.match(/"commentCount":(\d+)/);
    if (commentMatch) comments = parseInt(commentMatch[1]);

    const shareMatch = html.match(/"shareCount":(\d+)/);
    if (shareMatch) shares = parseInt(shareMatch[1]);

    // Extract video URL
    let videoUrl = '';
    const videoMatch = html.match(/"playAddr":"([^"]+)"/);
    if (videoMatch) {
      videoUrl = videoMatch[1].replace(/\\u002F/g, '/');
      videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
    }

    // Extract cover
    let cover = '';
    const coverMatch = html.match(/"cover":"([^"]+)"/);
    if (coverMatch) {
      cover = coverMatch[1].replace(/\\u002F/g, '/');
    }

    // Extract duration
    let duration = 0;
    const durationMatch = html.match(/"duration":(\d+)/);
    if (durationMatch) duration = parseInt(durationMatch[1]);

    return {
      id: videoId,
      title: title,
      description: title,
      author: author,
      nickname: author,
      duration: duration,
      cover: cover,
      audio: '',
      videoUrl: videoUrl,
      plays: plays,
      likes: likes,
      comments: comments,
      shares: shares,
    };

  } catch (error) {
    console.log('❌ Regex extract error:', error.message);
    return null;
  }
      }
