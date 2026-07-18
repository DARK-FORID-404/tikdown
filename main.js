// ============================================================
// TIKTOK API - MINIMAL WORKING VERSION WITH DEBUG LOGS
// ============================================================

// Enable debug logging
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

Deno.serve(async (request) => {
  try {
    log('📥 Request received:', request.url);
    
    const url = new URL(request.url);
    const tiktokUrl = url.searchParams.get('url');

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!tiktokUrl) {
      log('❌ No URL provided');
      return new Response(
        JSON.stringify({ error: 'Missing ?url parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    log('📎 TikTok URL:', tiktokUrl);

    // -------- GET VIDEO DATA --------
    const videoData = await getTikTokVideo(tiktokUrl);

    if (!videoData) {
      throw new Error('Could not get video data');
    }

    log('✅ Success! Title:', videoData.title);

    // -------- BUILD RESPONSE --------
    const responsePayload = {
      success: true,
      video_id: videoData.id || 'unknown',
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
    log('❌ ERROR:', error.message);
    log('❌ Stack:', error.stack);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
        stack: error.stack || 'No stack trace',
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
// GET TIKTOK VIDEO DATA
// ============================================================

async function getTikTokVideo(inputUrl) {
  log('🔍 Getting video data for:', inputUrl);

  // -------- STEP 1: Clean URL --------
  let cleanUrl = inputUrl.split('?')[0];
  log('🧹 Clean URL:', cleanUrl);

  // Handle short links
  if (cleanUrl.includes('vm.tiktok.com') || cleanUrl.includes('vt.tiktoklite.com')) {
    log('🔄 Following short link...');
    try {
      const response = await fetch(cleanUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      cleanUrl = response.url;
      log('🔗 Resolved to:', cleanUrl);
    } catch (e) {
      log('⚠️ Failed to follow short link:', e.message);
    }
  }

  // -------- STEP 2: Extract Video ID --------
  const videoId = extractVideoId(cleanUrl);
  if (!videoId) {
    log('❌ Could not extract video ID from:', cleanUrl);
    throw new Error('Could not extract video ID from URL');
  }
  log('🎬 Video ID:', videoId);

  // -------- STEP 3: Fetch TikTok Page --------
  log('🌐 Fetching TikTok page...');
  const html = await fetchTikTokPage(cleanUrl);
  if (!html) {
    log('❌ Failed to fetch page');
    throw new Error('Failed to fetch TikTok page');
  }
  log('📄 Page fetched, length:', html.length);

  // -------- STEP 4: Extract Data --------
  log('🔍 Extracting data from HTML...');
  const data = extractTikTokData(html, videoId);
  if (!data) {
    log('❌ Could not extract data');
    throw new Error('Could not extract video data from page');
  }

  log('✅ Data extracted successfully');
  return data;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function extractVideoId(url) {
  log('🔎 Extracting video ID from:', url);
  
  const patterns = [
    /\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /(\d{19})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      log('✅ Found ID:', match[1]);
      return match[1];
    }
  }

  log('❌ No ID found');
  return null;
}

async function fetchTikTokPage(url) {
  try {
    log('🌐 Fetching:', url);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    log('📊 Response status:', response.status);

    if (!response.ok) {
      log('❌ Response not OK:', response.status);
      return null;
    }

    const html = await response.text();
    log('📄 HTML length:', html.length);
    return html;

  } catch (error) {
    log('❌ Fetch error:', error.message);
    return null;
  }
}

function extractTikTokData(html, videoId) {
  log('🔍 Extracting data...');

  try {
    // -------- METHOD 1: SIGI_STATE --------
    log('🔎 Looking for SIGI_STATE...');
    const sigiMatch = html.match(/window\.SIGI_STATE\s*=\s*({.*?});/s);
    if (sigiMatch) {
      log('✅ Found SIGI_STATE');
      try {
        const data = JSON.parse(sigiMatch[1]);
        const result = parseSigiData(data, videoId);
        if (result) {
          log('✅ Parsed SIGI_STATE successfully');
          return result;
        }
      } catch (e) {
        log('⚠️ Failed to parse SIGI_STATE:', e.message);
      }
    }

    // -------- METHOD 2: ItemModule --------
    log('🔎 Looking for ItemModule...');
    const itemMatch = html.match(/"ItemModule":\s*({[^}]*})/s);
    if (itemMatch) {
      log('✅ Found ItemModule');
      try {
        const items = JSON.parse(itemMatch[1]);
        const keys = Object.keys(items);
        if (keys.length > 0) {
          const item = items[keys[0]];
          const result = parseItem(item, videoId);
          if (result) {
            log('✅ Parsed ItemModule successfully');
            return result;
          }
        }
      } catch (e) {
        log('⚠️ Failed to parse ItemModule:', e.message);
      }
    }

    // -------- METHOD 3: Regex Fallback --------
    log('🔎 Using regex fallback...');
    const result = extractWithRegex(html, videoId);
    if (result) {
      log('✅ Regex extraction successful');
      return result;
    }

    log('❌ All extraction methods failed');
    return null;

  } catch (error) {
    log('❌ Extract error:', error.message);
    return null;
  }
}

function parseSigiData(data, videoId) {
  try {
    let itemData = null;

    if (data.ItemModule) {
      const keys = Object.keys(data.ItemModule);
      if (keys.length > 0) {
        itemData = data.ItemModule[keys[0]];
        log('📦 Found ItemModule with', keys.length, 'items');
      }
    }

    if (!itemData) {
      log('⚠️ No ItemModule found in SIGI_STATE');
      return null;
    }

    return parseItem(itemData, videoId);

  } catch (error) {
    log('❌ parseSigiData error:', error.message);
    return null;
  }
}

function parseItem(item, videoId) {
  try {
    log('📦 Parsing item...');

    // Get video URL
    let videoUrl = '';
    if (item.video?.playAddr) {
      videoUrl = item.video.playAddr;
      log('🎬 Found playAddr');
    } else if (item.video?.downloadAddr) {
      videoUrl = item.video.downloadAddr;
      log('🎬 Found downloadAddr');
    } else if (item.playAddr) {
      videoUrl = item.playAddr;
      log('🎬 Found playAddr in root');
    }

    // Remove watermark
    if (videoUrl) {
      videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
      videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
      log('🎬 Cleaned video URL:', videoUrl.substring(0, 100) + '...');
    }

    // Get author
    const author = item.author || {};
    const stats = item.stats || {};

    const result = {
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

    log('✅ Parsed item:', result.title);
    return result;

  } catch (error) {
    log('❌ parseItem error:', error.message);
    return null;
  }
}

function extractWithRegex(html, videoId) {
  try {
    log('🔍 Running regex extraction...');

    // Extract title
    let title = 'No title';
    const titleMatch = html.match(/"desc":"([^"]+)"/);
    if (titleMatch) {
      title = titleMatch[1];
      log('📝 Found title:', title.substring(0, 50) + '...');
    }

    // Extract author
    let author = 'unknown';
    const authorMatch = html.match(/"uniqueId":"([^"]+)"/);
    if (authorMatch) {
      author = authorMatch[1];
      log('👤 Found author:', author);
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

    log('📊 Stats - Plays:', plays, 'Likes:', likes);

    // Extract video URL
    let videoUrl = '';
    const videoMatch = html.match(/"playAddr":"([^"]+)"/);
    if (videoMatch) {
      videoUrl = videoMatch[1].replace(/\\u002F/g, '/');
      videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
      log('🎬 Found video URL');
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
    log('❌ Regex extract error:', error.message);
    return null;
  }
}
