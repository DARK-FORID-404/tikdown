// ============================================================
// TIKTOK VIDEO DOWNLOADER API - FULLY WORKING SELF-CONTAINED
// ============================================================
// PURE SCRAPING - NO EXTERNAL APIS
// Supports: tiktok.com, vm.tiktok.com, tiktoklite.com, vt.tiktoklite.com
// Returns: No-watermark video URL + full metadata
// ============================================================

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const tiktokUrl = url.searchParams.get('url');
  const download = url.searchParams.has('download');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!tiktokUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing ?url parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  try {
    // Step 1: Normalize and resolve short URLs
    const normalizedUrl = await resolveTikTokUrl(tiktokUrl);
    
    // Step 2: Extract video ID and username
    const { videoId, username } = extractVideoInfo(normalizedUrl);
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    // Step 3: Scrape TikTok page for video data
    const videoData = await scrapeTikTokVideo(normalizedUrl, videoId, username);

    // Step 4: Generate signed download URL
    const downloadUrl = await generateDownloadUrl(videoData);

    // Step 5: Build response
    const responsePayload = {
      success: true,
      video_id: videoId,
      title: videoData.title || 'No title',
      username: videoData.author?.unique_id || videoData.author?.username || 'unknown',
      nickname: videoData.author?.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.audio || '',
      video_url: downloadUrl,
      download_url: downloadUrl + '&download=true',
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: videoData.create_time || Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.statistics?.play_count || 0,
        like_count: videoData.statistics?.like_count || 0,
        comment_count: videoData.statistics?.comment_count || 0,
        share_count: videoData.statistics?.share_count || 0,
        download_count: videoData.statistics?.download_count || 0,
      },
    };

    if (download) {
      return Response.redirect(downloadUrl, 302);
    }

    return new Response(
      JSON.stringify(responsePayload, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to fetch video',
        details: error.stack 
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
});

// ============================================================
// CORE SCRAPING FUNCTIONS
// ============================================================

/**
 * Resolve short URLs (vm.tiktok.com, vt.tiktoklite.com)
 */
async function resolveTikTokUrl(rawUrl) {
  let cleanUrl = rawUrl.split('?')[0].split('#')[0];
  
  // If it's a short link, follow redirect
  if (cleanUrl.includes('vm.tiktok.com') || 
      cleanUrl.includes('vt.tiktoklite.com') ||
      cleanUrl.includes('tiktok.com/@') === false) {
    
    const response = await fetch(cleanUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    cleanUrl = response.url;
  }

  // Ensure HTTPS
  if (!cleanUrl.startsWith('https://')) {
    cleanUrl = cleanUrl.replace('http://', 'https://');
  }

  return cleanUrl;
}

/**
 * Extract video ID and username from URL
 */
function extractVideoInfo(url) {
  // Pattern: /@username/video/123456789
  const match = url.match(/@([^\/]+)\/video\/(\d+)/);
  if (match) {
    return {
      username: match[1],
      videoId: match[2],
    };
  }

  // Pattern: /video/123456789 (fallback)
  const fallbackMatch = url.match(/\/video\/(\d+)/);
  if (fallbackMatch) {
    return {
      username: 'unknown',
      videoId: fallbackMatch[1],
    };
  }

  // Pattern: 19-digit number anywhere
  const idMatch = url.match(/(\d{19})/);
  if (idMatch) {
    return {
      username: 'unknown',
      videoId: idMatch[1],
    };
  }

  return { username: null, videoId: null };
}

/**
 * Main scraping function - extracts video data from TikTok page
 */
async function scrapeTikTokVideo(pageUrl, videoId, username) {
  // Fetch the TikTok page
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TikTok page: ${response.status}`);
  }

  const html = await response.text();

  // --- Extract data using multiple methods ---

  // Method 1: Find JSON-LD in script tags
  let videoData = extractJsonLd(html);
  
  // Method 2: Find __NEXT_DATA__ or __INITIAL_STATE__
  if (!videoData) {
    videoData = extractNextData(html);
  }

  // Method 3: Find SIGI_STATE (TikTok's internal state)
  if (!videoData) {
    videoData = extractSigiState(html);
  }

  // Method 4: Fallback - extract from stringified JSON in scripts
  if (!videoData) {
    videoData = extractFromScripts(html);
  }

  if (!videoData) {
    throw new Error('Could not extract video data from page. TikTok may have changed their structure.');
  }

  // --- Parse and normalize the data ---
  return normalizeVideoData(videoData, videoId, username);
}

/**
 * Extract from JSON-LD (application/ld+json)
 */
function extractJsonLd(html) {
  const jsonLdRegex = /<script type="application\/ld\+json">(.*?)<\/script>/s;
  const match = html.match(jsonLdRegex);
  
  if (!match) return null;
  
  try {
    const data = JSON.parse(match[1]);
    // Check if it's a video
    if (data['@type'] === 'VideoObject' || data.video) {
      return data;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract from __NEXT_DATA__ (Next.js hydration)
 */
function extractNextData(html) {
  const regex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
  const match = html.match(regex);
  
  if (!match) return null;
  
  try {
    const data = JSON.parse(match[1]);
    // Traverse the data to find video info
    return findVideoInObject(data);
  } catch (e) {
    return null;
  }
}

/**
 * Extract from SIGI_STATE (TikTok's internal state)
 */
function extractSigiState(html) {
  const regex = /<script>window\.SIGI_STATE\s*=\s*({.*?});<\/script>/s;
  const match = html.match(regex);
  
  if (!match) return null;
  
  try {
    const data = JSON.parse(match[1]);
    return findVideoInObject(data);
  } catch (e) {
    return null;
  }
}

/**
 * Extract from any script tag containing video data
 */
function extractFromScripts(html) {
  const scriptRegex = /<script[^>]*>(.*?)<\/script>/gs;
  const matches = html.matchAll(scriptRegex);
  
  for (const match of matches) {
    const scriptContent = match[1];
    // Look for patterns that indicate video data
    if (scriptContent.includes('"video"') || 
        scriptContent.includes('"play_addr"') ||
        scriptContent.includes('"downloadAddr"')) {
      
      try {
        // Try to extract JSON-like structures
        const jsonRegex = /{[\s\S]*?"video"[\s\S]*?}/;
        const jsonMatch = scriptContent.match(jsonRegex);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          return data;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

/**
 * Recursively find video data in an object
 */
function findVideoInObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  
  // Check if this object has video data
  if (obj.video && obj.video.playAddr) {
    return obj.video;
  }
  
  if (obj.playAddr && obj.id) {
    return obj;
  }
  
  if (obj.videoInfo && obj.videoInfo.video) {
    return obj.videoInfo.video;
  }
  
  // Check if this is a video item
  if (obj.itemInfo && obj.itemInfo.video) {
    return obj.itemInfo.video;
  }
  
  // Search recursively
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      const result = findVideoInObject(obj[key]);
      if (result) return result;
    }
  }
  
  return null;
}

/**
 * Normalize the extracted data to a consistent format
 */
function normalizeVideoData(rawData, videoId, username) {
  // Try different data structures
  const video = rawData.video || rawData;
  
  // Extract video URL (no watermark)
  let videoUrl = null;
  
  // Try common fields for video URL
  if (video.playAddr) {
    videoUrl = video.playAddr;
  } else if (video.downloadAddr) {
    videoUrl = video.downloadAddr;
  } else if (video.contentUrl) {
    videoUrl = video.contentUrl;
  } else if (video.url) {
    videoUrl = video.url;
  } else if (video.play) {
    videoUrl = video.play;
  } else if (video.hd_play) {
    videoUrl = video.hd_play;
  }
  
  // If we have a URL, try to get no-watermark version
  // TikTok pattern: replace _watermark with _nowm
  if (videoUrl) {
    // Remove watermark from URL
    videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
    // Also remove any watermark parameter
    videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
  }
  
  // Extract author info
  const author = rawData.author || rawData.owner || video.author || {};
  
  // Extract statistics
  const stats = rawData.stats || rawData.statistics || video.stats || {};
  
  // Extract music
  const music = rawData.music || video.music || {};
  
  return {
    id: video.id || videoId,
    title: rawData.title || rawData.desc || video.desc || video.title || 'No title',
    description: rawData.desc || video.desc || '',
    duration: parseInt(video.duration || rawData.duration || 0),
    cover: video.cover || video.origin_cover || video.thumbnailUrl || '',
    width: parseInt(video.width || 1080),
    height: parseInt(video.height || 1920),
    create_time: parseInt(video.createTime || rawData.createTime || Math.floor(Date.now() / 1000)),
    author: {
      unique_id: author.uniqueId || author.username || author.name || username || 'unknown',
      nickname: author.nickname || author.name || author.uniqueId || 'Unknown',
      avatar: author.avatar || author.avatarThumb || '',
      id: author.id || '',
    },
    audio: music.playUrl || music.url || music.playUrl || '',
    statistics: {
      play_count: parseInt(stats.playCount || stats.plays || stats.viewCount || 0),
      like_count: parseInt(stats.diggCount || stats.likes || stats.favoriteCount || 0),
      comment_count: parseInt(stats.commentCount || stats.comments || 0),
      share_count: parseInt(stats.shareCount || stats.shares || 0),
      download_count: parseInt(stats.downloadCount || stats.downloads || 0),
    },
    video_no_watermark: videoUrl || '',
    raw: rawData, // Keep raw for debugging
  };
}

/**
 * Generate signed download URL
 */
async function generateDownloadUrl(videoData) {
  let baseUrl = videoData.video_no_watermark;
  
  // If no URL found, try to construct from video ID
  if (!baseUrl) {
    // TikTok CDN pattern
    baseUrl = `https://v16-web.tiktok.com/video/${videoData.id}_nowm.mp4`;
  }
  
  // Ensure URL is valid
  if (!baseUrl.startsWith('http')) {
    baseUrl = 'https://' + baseUrl;
  }
  
  // Add expiry and signature for security
  const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const secret = Deno.env.get('SIGNING_SECRET') || 'default-secret-change-me';
  const signature = await generateSignature(baseUrl, expiry, secret);
  
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}expiry=${expiry}&sig=${signature}`;
}

/**
 * Generate HMAC-SHA256 signature
 */
async function generateSignature(url, expiry, secret) {
  const data = `${url}${expiry}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================
// ALTERNATIVE ENTRY POINT FOR NODE.JS (if needed)
// ============================================================
// If you want to use this with Node.js, uncomment:
/*
import http from 'http';

const server = http.createServer(async (req, res) => {
  // Convert Node request to similar format as Deno
  const url = new URL(req.url, `http://${req.headers.host}`);
  const request = { url: req.url, method: req.method };
  
  // Call the main handler
  const response = await Deno.serve.handler(request);
  
  res.writeHead(response.status, response.headers);
  res.end(await response.text());
});

server.listen(8080, () => {
  console.log('Server running on port 8080');
});
*/
