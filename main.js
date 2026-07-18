// ============================================================
// TIKTOK DOWNLOADER - REAL WORKING VERSION
// SCRAPES ACTUAL DATA FROM TIKTOK FOR EVERY VIDEO
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
    // Get REAL data from TikTok
    const videoData = await scrapeRealTikTokData(tiktokUrl);
    
    if (!videoData) {
      throw new Error('Could not extract video data. Video may be private or unavailable.');
    }

    const responsePayload = {
      success: true,
      video_id: videoData.id,
      title: videoData.title || 'No title',
      username: videoData.author?.unique_id || videoData.author?.username || 'unknown',
      nickname: videoData.author?.nickname || '',
      description: videoData.description || '',
      duration: videoData.duration || 0,
      cover: videoData.cover || '',
      audio: videoData.music?.play_url || '',
      video_url: videoData.video_url || '',
      download_url: videoData.video_url ? videoData.video_url + '&download=true' : '',
      width: videoData.width || 1080,
      height: videoData.height || 1920,
      created_at: videoData.create_time || Math.floor(Date.now() / 1000),
      statistics: {
        play_count: videoData.statistics?.play_count || 0,
        like_count: videoData.statistics?.like_count || 0,
        comment_count: videoData.statistics?.comment_count || 0,
        share_count: videoData.statistics?.share_count || 0,
      },
    };

    if (download && videoData.video_url) {
      return Response.redirect(videoData.video_url, 302);
    }

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
// CORE SCRAPING FUNCTION - GETS REAL DATA
// ============================================================

async function scrapeRealTikTokData(inputUrl) {
  // Step 1: Resolve short URLs
  let pageUrl = await resolveTikTokUrl(inputUrl);
  
  // Step 2: Extract video ID
  const videoId = extractVideoId(pageUrl);
  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }
  
  // Step 3: Fetch TikTok page
  const html = await fetchTikTokPage(pageUrl);
  if (!html) {
    throw new Error('Failed to fetch TikTok page');
  }
  
  // Step 4: Extract data from page
  const extracted = extractRealData(html, videoId);
  if (!extracted) {
    throw new Error('Could not extract video data from page');
  }
  
  // Step 5: Get no-watermark video URL
  const videoUrl = getNoWatermarkUrl(extracted);
  
  // Step 6: Return structured data
  return {
    id: extracted.id || videoId,
    title: extracted.title || extracted.desc || 'No title',
    description: extracted.desc || '',
    duration: parseInt(extracted.duration || 0),
    cover: extracted.cover || extracted.thumbnail || '',
    width: parseInt(extracted.width || 1080),
    height: parseInt(extracted.height || 1920),
    create_time: parseInt(extracted.createTime || Math.floor(Date.now() / 1000)),
    author: {
      unique_id: extracted.author?.uniqueId || extracted.author?.username || extracted.author?.name || '',
      nickname: extracted.author?.nickname || extracted.author?.name || '',
      avatar: extracted.author?.avatar || '',
    },
    music: {
      play_url: extracted.music?.playUrl || extracted.music?.url || '',
    },
    statistics: {
      play_count: parseInt(extracted.stats?.playCount || extracted.playCount || 0),
      like_count: parseInt(extracted.stats?.diggCount || extracted.diggCount || 0),
      comment_count: parseInt(extracted.stats?.commentCount || extracted.commentCount || 0),
      share_count: parseInt(extracted.stats?.shareCount || extracted.shareCount || 0),
    },
    video_url: videoUrl,
  };
}

// ============================================================
// EXTRACTION FUNCTIONS
// ============================================================

async function resolveTikTokUrl(url) {
  let cleanUrl = url.split('?')[0].split('#')[0];
  
  if (cleanUrl.includes('vm.tiktok.com') || cleanUrl.includes('vt.tiktoklite.com')) {
    try {
      const response = await fetch(cleanUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      cleanUrl = response.url;
    } catch (e) {
      // Keep original if redirect fails
    }
  }

  if (!cleanUrl.startsWith('https://')) {
    cleanUrl = cleanUrl.replace('http://', 'https://');
  }

  return cleanUrl;
}

function extractVideoId(url) {
  // Pattern: /video/123456789
  const match = url.match(/\/video\/(\d+)/);
  if (match) return match[1];
  
  // Pattern: /v/123456789
  const vMatch = url.match(/\/v\/(\d+)/);
  if (vMatch) return vMatch[1];
  
  // Pattern: 19-digit number
  const idMatch = url.match(/(\d{19})/);
  if (idMatch) return idMatch[1];
  
  return null;
}

async function fetchTikTokPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function extractRealData(html, videoId) {
  let result = null;
  
  // ----- METHOD 1: SIGI_STATE (Most reliable) -----
  const sigiMatch = html.match(/<script>window\.SIGI_STATE\s*=\s*({.*?});<\/script>/s);
  if (sigiMatch) {
    try {
      const data = JSON.parse(sigiMatch[1]);
      result = parseSigiData(data);
      if (result && result.title && result.title !== '') {
        return result;
      }
    } catch (e) {}
  }
  
  // ----- METHOD 2: __NEXT_DATA__ -----
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      result = parseNextData(data);
      if (result && result.title && result.title !== '') {
        return result;
      }
    } catch (e) {}
  }
  
  // ----- METHOD 3: JSON-LD -----
  const ldMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      result = parseLdData(data);
      if (result && result.title && result.title !== '') {
        return result;
      }
    } catch (e) {}
  }
  
  // ----- METHOD 4: Manual extraction from script -----
  const scriptRegex = /<script[^>]*>(.*?)<\/script>/gs;
  const matches = html.matchAll(scriptRegex);
  for (const match of matches) {
    const content = match[1];
    if (content.includes('"ItemModule"') || content.includes('"videoData"') || content.includes('"playAddr"')) {
      try {
        // Extract JSON-like object
        const jsonMatch = content.match(/{[\s\S]*?(?:ItemModule|videoData|playAddr)[\s\S]*?}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          result = parseGenericData(parsed);
          if (result && result.title && result.title !== '') {
            return result;
          }
        }
      } catch (e) {}
    }
  }
  
  // ----- METHOD 5: Direct regex extraction (fallback) -----
  result = extractViaRegex(html, videoId);
  if (result && result.title && result.title !== '') {
    return result;
  }
  
  return null;
}

function parseSigiData(data) {
  let itemData = null;
  
  // Find ItemModule
  if (data.ItemModule) {
    const keys = Object.keys(data.ItemModule);
    if (keys.length > 0) {
      itemData = data.ItemModule[keys[0]];
    }
  }
  
  // If not found, search recursively
  if (!itemData) {
    function search(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.desc && obj.id) return obj;
      if (obj.video && obj.video.downloadAddr) return obj;
      
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          const result = search(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }
    itemData = search(data);
  }
  
  if (!itemData) return null;
  
  return {
    id: itemData.id || '',
    title: itemData.desc || '',
    desc: itemData.desc || '',
    duration: itemData.duration || 0,
    cover: itemData.cover || itemData.originCover || '',
    author: {
      uniqueId: itemData.author?.uniqueId || itemData.author?.username || '',
      nickname: itemData.author?.nickname || itemData.author?.name || '',
      avatar: itemData.author?.avatar || '',
    },
    stats: {
      playCount: itemData.stats?.playCount || itemData.playCount || 0,
      diggCount: itemData.stats?.diggCount || itemData.diggCount || 0,
      commentCount: itemData.stats?.commentCount || itemData.commentCount || 0,
      shareCount: itemData.stats?.shareCount || itemData.shareCount || 0,
    },
    music: {
      playUrl: itemData.music?.playUrl || '',
    },
    video: {
      playAddr: itemData.video?.playAddr || itemData.video?.downloadAddr || '',
      downloadAddr: itemData.video?.downloadAddr || '',
    },
  };
}

function parseNextData(data) {
  let videoData = null;
  
  // Try common paths
  const paths = [
    'props.pageProps.videoData',
    'props.pageProps.videoData.video',
    'props.pageProps.initialState.video',
    'props.pageProps.initialState',
  ];
  
  for (const path of paths) {
    const parts = path.split('.');
    let current = data;
    let found = true;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && current) {
      videoData = current;
      break;
    }
  }
  
  if (!videoData) return null;
  
  return {
    id: videoData.id || '',
    title: videoData.title || videoData.desc || '',
    desc: videoData.desc || '',
    duration: videoData.duration || 0,
    cover: videoData.cover || videoData.thumbnail || '',
    author: {
      uniqueId: videoData.author?.uniqueId || videoData.author?.username || '',
      nickname: videoData.author?.nickname || videoData.author?.name || '',
      avatar: videoData.author?.avatar || '',
    },
    stats: {
      playCount: videoData.stats?.playCount || videoData.playCount || 0,
      diggCount: videoData.stats?.diggCount || videoData.diggCount || 0,
      commentCount: videoData.stats?.commentCount || videoData.commentCount || 0,
      shareCount: videoData.stats?.shareCount || videoData.shareCount || 0,
    },
    music: {
      playUrl: videoData.music?.playUrl || '',
    },
    video: {
      playAddr: videoData.video?.playAddr || videoData.video?.downloadAddr || '',
      downloadAddr: videoData.video?.downloadAddr || '',
    },
  };
}

function parseLdData(data) {
  if (data['@type'] !== 'VideoObject' && !data.video) return null;
  
  const video = data.video || data;
  
  return {
    id: video.identifier || '',
    title: video.name || '',
    desc: video.description || '',
    duration: parseInt(video.duration || 0),
    cover: video.thumbnailUrl || '',
    author: {
      uniqueId: video.author?.identifier || '',
      nickname: video.author?.name || '',
    },
    stats: {
      playCount: parseInt(video.interactionCount || 0),
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
    },
    video: {
      playAddr: video.contentUrl || video.url || '',
    },
  };
}

function parseGenericData(data) {
  function search(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.desc && obj.id) return obj;
    if (obj.video && obj.video.playAddr) return obj;
    
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        const result = search(obj[key]);
        if (result) return result;
      }
    }
    return null;
  }
  
  const itemData = search(data);
  if (!itemData) return null;
  
  return {
    id: itemData.id || '',
    title: itemData.desc || itemData.title || '',
    desc: itemData.desc || '',
    duration: itemData.duration || 0,
    cover: itemData.cover || '',
    author: {
      uniqueId: itemData.author?.uniqueId || '',
      nickname: itemData.author?.nickname || '',
      avatar: itemData.author?.avatar || '',
    },
    stats: {
      playCount: itemData.stats?.playCount || 0,
      diggCount: itemData.stats?.diggCount || 0,
      commentCount: itemData.stats?.commentCount || 0,
      shareCount: itemData.stats?.shareCount || 0,
    },
    music: {
      playUrl: itemData.music?.playUrl || '',
    },
    video: {
      playAddr: itemData.video?.playAddr || itemData.video?.downloadAddr || '',
      downloadAddr: itemData.video?.downloadAddr || '',
    },
  };
}

function extractViaRegex(html, videoId) {
  const result = {
    id: videoId,
    title: '',
    desc: '',
    duration: 0,
    cover: '',
    author: { uniqueId: '', nickname: '', avatar: '' },
    stats: { playCount: 0, diggCount: 0, commentCount: 0, shareCount: 0 },
    music: { playUrl: '' },
    video: { playAddr: '', downloadAddr: '' },
  };
  
  // Extract title
  const titleMatch = html.match(/"desc":"([^"]+)"/);
  if (titleMatch) {
    result.title = titleMatch[1];
    result.desc = titleMatch[1];
  }
  
  // Extract author
  const authorMatch = html.match(/"uniqueId":"([^"]+)"/);
  if (authorMatch) {
    result.author.uniqueId = authorMatch[1];
    result.author.nickname = authorMatch[1];
  }
  
  // Extract stats
  const playMatch = html.match(/"playCount":(\d+)/);
  if (playMatch) result.stats.playCount = parseInt(playMatch[1]);
  
  const likeMatch = html.match(/"diggCount":(\d+)/);
  if (likeMatch) result.stats.diggCount = parseInt(likeMatch[1]);
  
  const commentMatch = html.match(/"commentCount":(\d+)/);
  if (commentMatch) result.stats.commentCount = parseInt(commentMatch[1]);
  
  const shareMatch = html.match(/"shareCount":(\d+)/);
  if (shareMatch) result.stats.shareCount = parseInt(shareMatch[1]);
  
  // Extract video URL
  const videoMatch = html.match(/"playAddr":"([^"]+)"/);
  if (videoMatch) {
    result.video.playAddr = videoMatch[1].replace(/\\u002F/g, '/');
  }
  
  const downloadMatch = html.match(/"downloadAddr":"([^"]+)"/);
  if (downloadMatch) {
    result.video.downloadAddr = downloadMatch[1].replace(/\\u002F/g, '/');
  }
  
  // Extract cover
  const coverMatch = html.match(/"cover":"([^"]+)"/);
  if (coverMatch) {
    result.cover = coverMatch[1].replace(/\\u002F/g, '/');
  }
  
  // Extract duration
  const durationMatch = html.match(/"duration":(\d+)/);
  if (durationMatch) result.duration = parseInt(durationMatch[1]);
  
  return result;
}

function getNoWatermarkUrl(data) {
  let videoUrl = '';
  
  if (data.video?.playAddr) {
    videoUrl = data.video.playAddr;
  } else if (data.video?.downloadAddr) {
    videoUrl = data.video.downloadAddr;
  } else if (data.playAddr) {
    videoUrl = data.playAddr;
  }
  
  if (!videoUrl) return '';
  
  // Remove watermark
  videoUrl = videoUrl.replace(/_watermark/g, '_nowm');
  videoUrl = videoUrl.replace(/watermark=true/g, 'watermark=false');
  videoUrl = videoUrl.replace(/wm\./g, '');
  
  // Clean up
  videoUrl = videoUrl.replace(/\\/g, '');
  
  return videoUrl;
    }
