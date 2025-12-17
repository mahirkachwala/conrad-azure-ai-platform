const messagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');

let sessionId = sessionStorage.getItem('chat-session-id');
if (!sessionId) {
  sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('chat-session-id', sessionId);
}

let userLocation = null;
let lastSearchQuery = '';
let lastSearchResults = null;

// ============= VOICE INPUT SYSTEM (FasterWhisper) =============
const VOICE_SERVICE_URL = 'http://localhost:5001';
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Initialize voice button
document.addEventListener('DOMContentLoaded', () => {
  const voiceBtn = document.getElementById('voice-btn');
  const voiceModal = document.getElementById('voice-modal');
  const voiceStopBtn = document.getElementById('voice-stop-btn');
  const voiceCancelBtn = document.getElementById('voice-cancel-btn');
  const voiceStatus = document.getElementById('voice-status');
  const voiceModalContent = document.querySelector('.voice-modal-content');
  
  if (voiceBtn) {
    voiceBtn.addEventListener('click', startVoiceRecording);
  }
  
  if (voiceStopBtn) {
    voiceStopBtn.addEventListener('click', stopAndTranscribe);
  }
  
  if (voiceCancelBtn) {
    voiceCancelBtn.addEventListener('click', cancelRecording);
  }
  
  // Check if voice service is available
  checkVoiceService();
});

async function checkVoiceService() {
  try {
    const response = await fetch(`${VOICE_SERVICE_URL}/health`, { 
      method: 'GET',
      mode: 'cors'
    });
    if (response.ok) {
      const data = await response.json();
      console.log('🎤 Voice service available:', data);
      const voiceBtn = document.getElementById('voice-btn');
      if (voiceBtn) {
        voiceBtn.title = `Voice Input Ready (FasterWhisper ${data.cuda_available ? '+ CUDA' : 'CPU'})`;
      }
    }
  } catch (e) {
    console.log('⚠️ Voice service not available. Start it with: python voice-service/voice_server.py');
    const voiceBtn = document.getElementById('voice-btn');
    if (voiceBtn) {
      voiceBtn.title = 'Voice service offline - click to see instructions';
      voiceBtn.style.opacity = '0.5';
    }
  }
}

async function startVoiceRecording() {
  const voiceBtn = document.getElementById('voice-btn');
  const voiceModal = document.getElementById('voice-modal');
  const voiceStatus = document.getElementById('voice-status');
  
  // Check if service is available first
  try {
    const healthCheck = await fetch(`${VOICE_SERVICE_URL}/health`, { mode: 'cors' });
    if (!healthCheck.ok) throw new Error('Service unavailable');
  } catch (e) {
    addMessage(`
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 10px; padding: 16px; color: #92400e;">
        <strong>🎤 Voice Service Not Running</strong>
        <p style="margin: 10px 0 0 0;">To use voice input, start the FasterWhisper service:</p>
        <pre style="background: #1e293b; color: #10b981; padding: 10px; border-radius: 6px; margin-top: 10px; overflow-x: auto;">
cd voice-service
python voice_server.py</pre>
        <p style="margin: 10px 0 0 0; font-size: 13px; color: #b45309;">
          The service runs on port 5001 and uses your local FasterWhisper large-v3 model.
        </p>
      </div>
    `, false);
    return;
  }
  
  try {
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      } 
    });
    
    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
    };
    
    // Start recording
    mediaRecorder.start(100); // Collect data every 100ms
    isRecording = true;
    
    // Show modal
    voiceModal.style.display = 'flex';
    voiceBtn.classList.add('recording');
    voiceStatus.textContent = '🎤 Listening...';
    
    console.log('🎤 Voice recording started');
    
  } catch (err) {
    console.error('Microphone access error:', err);
    addMessage(`
      <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
        <strong>❌ Microphone Access Denied</strong>
        <p style="margin: 8px 0 0 0;">Please allow microphone access in your browser settings to use voice input.</p>
      </div>
    `, false);
  }
}

async function stopAndTranscribe() {
  if (!mediaRecorder || !isRecording) return;
  
  const voiceModal = document.getElementById('voice-modal');
  const voiceStatus = document.getElementById('voice-status');
  const voiceModalContent = document.querySelector('.voice-modal-content');
  const voiceBtn = document.getElementById('voice-btn');
  
  // Stop recording
  mediaRecorder.stop();
  isRecording = false;
  voiceBtn.classList.remove('recording');
  
  // Show transcribing state
  voiceStatus.textContent = '🔄 Transcribing with FasterWhisper...';
  voiceModalContent.classList.add('transcribing');
  
  // Wait for all chunks
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Create audio blob
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  
  console.log(`🎤 Audio recorded: ${audioBlob.size} bytes`);
  
  if (audioBlob.size < 1000) {
    voiceModal.style.display = 'none';
    voiceModalContent.classList.remove('transcribing');
    addMessage('⚠️ Recording too short. Please speak for at least 1 second.', false);
    return;
  }
  
  try {
    // Send to FasterWhisper service
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    
    const response = await fetch(`${VOICE_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: formData,
      mode: 'cors'
    });
    
    const result = await response.json();
    
    // Hide modal
    voiceModal.style.display = 'none';
    voiceModalContent.classList.remove('transcribing');
    
    if (result.success && result.text) {
      const transcribedText = result.text.trim();
      console.log('✅ Transcribed:', transcribedText);
      
      // Show transcription and auto-fill input
      addMessage(`🎤 <em style="color: #10b981;">"${transcribedText}"</em>`, true);
      
      // Process as user input
      userInput.value = transcribedText;
      
      // Auto-submit after short delay
      setTimeout(() => {
        chatForm.dispatchEvent(new Event('submit'));
      }, 500);
      
    } else {
      addMessage(`
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; color: #92400e;">
          <strong>⚠️ Could not transcribe audio</strong>
          <p style="margin: 8px 0 0 0;">Please try speaking more clearly or check your microphone.</p>
        </div>
      `, false);
    }
    
  } catch (error) {
    voiceModal.style.display = 'none';
    voiceModalContent.classList.remove('transcribing');
    console.error('Transcription error:', error);
    addMessage(`
      <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
        <strong>❌ Transcription Failed</strong>
        <p style="margin: 8px 0 0 0;">${error.message}</p>
      </div>
    `, false);
  }
}

function cancelRecording() {
  const voiceModal = document.getElementById('voice-modal');
  const voiceBtn = document.getElementById('voice-btn');
  const voiceModalContent = document.querySelector('.voice-modal-content');
  
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
  }
  
  voiceModal.style.display = 'none';
  voiceBtn.classList.remove('recording');
  voiceModalContent.classList.remove('transcribing');
  audioChunks = [];
  
  console.log('🎤 Recording cancelled');
}

// ============= END VOICE INPUT SYSTEM =============

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city: 'Detected',
        country: 'India'
      };
      console.log('Location detected:', userLocation);
    },
    (error) => {
      console.log('Location detection failed:', error.message);
    }
  );
}

function addMessage(content, isUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = isUser ? '👤' : '🤖';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (!isUser && typeof content === 'string' && (content.includes('\n') || content.includes('  •'))) {
    contentDiv.style.whiteSpace = 'pre-wrap';
  }
  
  contentDiv.innerHTML = content;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addLoadingMessage(message = 'Thinking...') {
  const loadingContent = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <span>${message}</span>
    </div>
  `;
  addMessage(loadingContent);
}

function removeLastMessage() {
  const lastMessage = messagesContainer.lastElementChild;
  if (lastMessage) {
    lastMessage.remove();
  }
}

function formatTenderResults(data) {
  const { totalTenders, totalValue, avgValue, categories, tenders, portals } = data;
  
  let html = '<div class="tender-results">';
  
  html += '<div class="stats-grid">';
  html += `
    <div class="stat-card">
      <div class="stat-value">${totalTenders}</div>
      <div class="stat-label">Tenders Found</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">₹${(totalValue / 10000000).toFixed(1)}Cr</div>
      <div class="stat-label">Total Value</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">₹${(avgValue / 10000000).toFixed(1)}Cr</div>
      <div class="stat-label">Avg Value</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${portals ? portals.length : 0}</div>
      <div class="stat-label">Portals Searched</div>
    </div>
  `;
  html += '</div>';
  
  // Add View Orchestration button
  html += `
    <div style="margin: 15px 0; display: flex; gap: 10px;">
      <button onclick="viewOrchestration('${lastSearchQuery || 'Cable Search'}')" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        🤖 View Agent Orchestration
      </button>
    </div>
  `;
  
  if (tenders && tenders.length > 0) {
    html += '<p><strong>All Results:</strong></p>';
    html += '<div class="tender-list">';
    
    const portalUrls = {
      'Government Procurement Portal': '/portals/gov.html',
      'Industrial Supply Network': '/portals/industrial.html',
      'Utilities & Infrastructure Hub': '/portals/utilities.html'
    };
    
    tenders.forEach(tender => {
      const portalUrl = portalUrls[tender.portal_name] || '#';
      const deepLinkUrl = `${portalUrl}#${tender.tender_id}`;
      const companyUrl = `/company.html?name=${encodeURIComponent(tender.organisation)}`;
      const dueDate = new Date(tender.due_date).toLocaleDateString('en-IN');
      const buyerType = tender.buyer_type || (tender.portal_name?.includes('Government') ? 'Government/PSU' : tender.portal_name?.includes('Industrial') ? 'Industrial' : 'Utility');
      const pdfUrl = tender.pdf_url || `/rfps/${tender.tender_id}.pdf`;
      html += `
        <div class="tender-item">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="tender-id">${tender.tender_id}</span>
            <span style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;">${buyerType}</span>
            ${tender.portal_name ? `<a href="${deepLinkUrl}" class="portal-tag-link"><span class="portal-tag">${tender.portal_name}</span></a>` : ''}
          </div>
          <div class="tender-title">📋 ${tender.title}</div>
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 3px solid #0284c7; padding: 8px 12px; border-radius: 4px; margin: 8px 0;">
            <div style="font-size: 11px; color: #0369a1; font-weight: 600;">🏢 BUYER (Requesting Organization):</div>
            <a href="${companyUrl}" class="company-link" target="_blank" style="font-weight: 700; color: #0c4a6e;">${tender.organisation}</a>
          </div>
          <div style="background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border-left: 3px solid #eab308; padding: 8px 12px; border-radius: 4px; margin: 8px 0;">
            <div style="font-size: 11px; color: #a16207; font-weight: 600;">📦 CABLES REQUIRED:</div>
            <div style="font-size: 13px; color: #713f12;">${tender.material || tender.title}</div>
          </div>
          <div class="tender-meta">
            <div class="meta-item">
              <span class="meta-label">📍 Delivery:</span> ${tender.city}
            </div>
            <div class="meta-item">
              <span class="meta-label">⏰ Deadline:</span> ${dueDate}
            </div>
            <div class="meta-item">
              <span class="meta-label">💰 Budget:</span> ₹${tender.estimated_cost_inr.toLocaleString('en-IN')}
            </div>
          </div>
          <div class="tender-actions-row">
            <a href="${pdfUrl}" target="_blank" class="action-btn" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); text-decoration: none;">
              📥 Download RFP PDF
            </a>
            <button class="action-btn reminder-btn" onclick="openReminderModal('${tender.tender_id}', '${tender.title.replace(/'/g, "\\'")}', '${tender.due_date}', '${tender.organisation.replace(/'/g, "\\'")}')">
              ⏰ Set Reminder
            </button>
            <button class="action-btn gmail-btn" onclick="composeTenderEmail('${tender.tender_id}', '${tender.title.replace(/'/g, "\\'")}', '${tender.organisation.replace(/'/g, "\\'")}', '${tender.due_date}', '${tender.contact_email || 'procurement@company.com'}')">
              📧 Email
            </button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  html += '</div>';
  
  if (tenders && tenders.length > 0) {
    // Store for workflow viewing
    lastSearchResults = { totalTenders, totalValue, portals, tenders };
    
    html += `
      <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
        <button class="analyze-btn" onclick="analyzeTenders(${JSON.stringify(tenders).replace(/"/g, '&quot;')})">
          🎯 Analyze & Get Ranked Recommendations
        </button>
      </div>
    `;
  }
  
  html += '</div>';
  return html;
}

/**
 * Format AI Search Results with Permutation Process Display
 * Shows: permutations used, keywords searched, SKU match status
 */
function formatAISearchResults(data, searchProcess) {
  const { totalTenders, tenders, portals } = data;
  
  let html = '<div class="ai-search-results">';
  
  // PROCESS EXPLANATION BOX
  if (searchProcess) {
    html += `
      <div class="search-process-box" style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
          <span style="font-size: 24px;">🤖</span>
          <h3 style="margin: 0; font-size: 18px;">AI Search Process</h3>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 15px;">
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${searchProcess.csvData?.totalProducts || 0}</div>
            <div style="font-size: 11px; opacity: 0.8;">Products in Catalog</div>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${searchProcess.permutations?.length || 0}</div>
            <div style="font-size: 11px; opacity: 0.8;">Permutations</div>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${searchProcess.searchesExecuted?.length || 0}</div>
            <div style="font-size: 11px; opacity: 0.8;">Searches Run</div>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${totalTenders}</div>
            <div style="font-size: 11px; opacity: 0.8;">RFPs Found</div>
          </div>
        </div>
        
        <div style="font-size: 12px; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
          <div style="font-weight: 600; margin-bottom: 8px;">🔍 Search Permutations Used:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${(searchProcess.permutations || []).map(p => `
              <span style="background: #3b82f6; padding: 4px 10px; border-radius: 15px; font-size: 11px;">
                ${p.keyword}
              </span>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }
  
  // VIEW ORCHESTRATION BUTTON
  html += `
    <div style="margin: 15px 0; display: flex; gap: 10px;">
      <button onclick="viewOrchestration('${lastSearchQuery || 'Cable Search'}')" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; font-size: 14px;">
        🤖 View Agent Orchestration
      </button>
    </div>
  `;
  
  // RESULTS HEADER
  html += `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <h3 style="margin: 0;">📋 RFPs Found (Ranked by Due Date)</h3>
      <span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 15px; font-size: 13px;">
        ${totalTenders} Results
      </span>
    </div>
  `;
  
  // TENDER CARDS
  if (tenders && tenders.length > 0) {
    html += '<div class="tender-list">';
    
    tenders.forEach((tender, idx) => {
      const dueDate = new Date(tender.due_date).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
      const pdfUrl = tender.pdf_url || `/rfps/${tender.tender_id}.pdf`;
      const skuMatch = tender.skuMatch || 0;
      const canBid = tender.canBid !== false;
      
      // Keywords used for this result
      const keywords = tender.keywordsUsed || [];
      
      html += `
        <div class="tender-item" style="border: ${canBid ? '2px solid #10b981' : '2px solid #f59e0b'}; position: relative;">
          <!-- Rank Badge -->
          <div style="position: absolute; top: -10px; left: -10px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">
            ${idx + 1}
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span class="tender-id" style="font-size: 16px; font-weight: bold;">${tender.tender_id}</span>
            <div style="display: flex; gap: 8px;">
              <span style="background: ${canBid ? '#dcfce7' : '#fef3c7'}; color: ${canBid ? '#166534' : '#92400e'}; padding: 4px 10px; border-radius: 15px; font-size: 11px; font-weight: 600;">
                ${canBid ? '✅ Can Bid' : '⚠️ Partial Match'}
              </span>
              <span style="background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 15px; font-size: 11px; font-weight: 600;">
                ${skuMatch}% SKU Match
              </span>
            </div>
          </div>
          
          <div class="tender-title" style="font-size: 14px; margin-bottom: 10px;">📋 ${tender.title}</div>
          
          <div style="background: #f0f9ff; border-left: 3px solid #0284c7; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px;">
            <div style="font-size: 11px; color: #0369a1; font-weight: 600;">🏢 BUYER:</div>
            <div style="font-weight: 700; color: #0c4a6e;">${tender.organisation}</div>
          </div>
          
          <!-- Keywords Used -->
          ${keywords.length > 0 ? `
            <div style="background: #fef3c7; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px;">
              <div style="font-size: 11px; color: #92400e; font-weight: 600; margin-bottom: 5px;">🔑 KEYWORDS MATCHED:</div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${keywords.map(k => `<span style="background: #fbbf24; color: #78350f; padding: 2px 8px; border-radius: 10px; font-size: 10px;">${k}</span>`).join('')}
              </div>
            </div>
          ` : ''}
          
          <!-- Cable Requirements -->
          ${tender.cable_requirements && tender.cable_requirements.length > 0 ? `
            <div style="background: #fefce8; border-left: 3px solid #eab308; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px;">
              <div style="font-size: 11px; color: #a16207; font-weight: 600; margin-bottom: 5px;">📦 CABLES REQUIRED (${tender.cable_requirements.length} items):</div>
              ${tender.cable_requirements.slice(0, 3).map((req, i) => `
                <div style="font-size: 12px; color: #713f12; padding: 2px 0;">
                  Item ${i + 1}: ${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size} - ${req.qty_km || 0} km
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="tender-meta" style="display: flex; gap: 15px; font-size: 12px; margin-bottom: 10px;">
            <div>📍 <strong>${tender.city || 'India'}</strong></div>
            <div>📅 <strong>Due: ${dueDate}</strong></div>
            <div>🌐 <strong>${tender.portal_name || 'Portal'}</strong></div>
          </div>
          
          <div class="tender-actions-row" style="display: flex; gap: 10px;">
            <a href="${pdfUrl}" target="_blank" class="action-btn" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); text-decoration: none; padding: 8px 16px; border-radius: 6px; color: white; font-size: 12px;">
              📥 Download RFP PDF
            </a>
            <button class="action-btn" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 8px 16px; border-radius: 6px; color: white; font-size: 12px; border: none; cursor: pointer;" onclick="proceedWithRFP('${tender.tender_id}')">
              🚀 Proceed with RFP
            </button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  } else {
    html += '<p style="text-align: center; color: #666;">No matching RFPs found. Try a different cable type or voltage.</p>';
  }
  
  html += '</div>';
  return html;
}

// Proceed with RFP action - Full Analysis
window.proceedWithRFP = function(tenderId, title) {
  addLoadingMessage(`Analyzing RFP ${tenderId}...`);
  
  // Make API call to get complete analysis
  fetch('/api/rfp-proceed/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenderId })
  })
  .then(res => res.json())
  .then(data => {
    removeLastMessage();
    
    if (!data.success) {
      addMessage(`❌ Error: ${data.error}`, false);
      return;
    }
    
    // Use data directly from analyzeRFP - it already has correct field names
    // The original analyzeRFP function returns: rfpId, rfpTitle, buyer, dueDate, 
    // cableRequirements, quotation, termsConditions, submissionMode, submissionPackage,
    // externalTestingRequired, externalTestingInfo, testingEmail
    const html = formatRFPAnalysis(data);
    addMessage(html, false);
  })
  .catch(err => {
    removeLastMessage();
    addMessage(`❌ Error analyzing RFP: ${err.message}`, false);
  });
};

/**
 * Format RFP Analysis results
 */
function formatRFPAnalysis(analysis) {
  const { rfpId, rfpTitle, buyer, dueDate, cableRequirements, quotation, termsConditions, submissionMode, submissionPackage, testingEmail, externalTestingRequired, externalTestingInfo } = analysis;
  
  let html = `
  <div class="rfp-analysis" style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 20px; border-radius: 12px; margin: 10px 0;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 15px;">
      <span style="font-size: 28px;">📋</span>
      <div>
        <h3 style="margin: 0; font-size: 18px;">RFP Analysis: ${rfpId}</h3>
        <p style="margin: 5px 0 0 0; opacity: 0.8; font-size: 13px;">${rfpTitle}</p>
      </div>
    </div>
    
    <!-- RFP Summary Card -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <div><strong>Buyer:</strong> ${buyer}</div>
        <div><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        <div><strong>Items Required:</strong> ${cableRequirements?.length || 0}</div>
        <div><strong>Submission Mode:</strong> <span style="background: #3b82f6; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${submissionMode}</span></div>
      </div>
    </div>
    
    <!-- Cable Requirements -->
    <div style="margin-bottom: 15px;">
      <h4 style="margin: 0 0 10px 0; font-size: 14px;">📦 Cable Requirements</h4>
      ${(cableRequirements || []).map((req, idx) => `
        <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #eab308;">
          <strong>Item ${idx + 1}:</strong> ${req.voltage} ${req.cable_type} ${req.cores}C x ${req.size}
          <span style="float: right; color: #a3e635;">${req.qty_km || 0} km</span>
        </div>
      `).join('')}
    </div>
    
    <!-- Quotation Summary - Customer Facing (No profit breakdown) -->
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <h4 style="margin: 0 0 10px 0; font-size: 14px;">💰 Price Quotation</h4>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
        <div>Material Supply Cost:</div><div style="text-align: right;">₹${quotation?.materialCost?.total?.toLocaleString('en-IN') || '0'}</div>
        <div>Testing & Certification:</div><div style="text-align: right;">₹${quotation?.testingCost?.total?.toLocaleString('en-IN') || '0'}</div>
        ${externalTestingRequired ? `<div>External Testing:</div><div style="text-align: right; color: #fef08a;">TBD*</div>` : ''}
        <div>GST (18%):</div><div style="text-align: right;">₹${quotation?.gst?.amount?.toLocaleString('en-IN') || '0'}</div>
        <div style="border-top: 1px solid rgba(255,255,255,0.3); padding-top: 8px; font-weight: bold;">${externalTestingRequired ? 'TOTAL (Excl. External Testing):' : 'GRAND TOTAL:'}</div>
        <div style="border-top: 1px solid rgba(255,255,255,0.3); padding-top: 8px; text-align: right; font-weight: bold; font-size: 16px;">₹${quotation?.grandTotal?.toLocaleString('en-IN') || '0'}</div>
      </div>
      ${externalTestingRequired ? `<div style="font-size: 11px; opacity: 0.9; margin-top: 8px;">* External testing cost pending quote from NABL accredited lab</div>` : ''}
    </div>
    
    ${externalTestingRequired && externalTestingInfo ? `
    <!-- External Testing Info -->
    <div style="background: rgba(99, 102, 241, 0.2); border: 1px solid #6366f1; padding: 12px; border-radius: 8px; margin-bottom: 15px;">
      <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #a5b4fc;">🧪 External Testing Required</h4>
      <div style="font-size: 12px;">
        <div>• Type: ${externalTestingInfo.type || 'Type Test'}</div>
        <div>• Standard: ${externalTestingInfo.standard || 'As per RFP'}</div>
        <div>• Est. Cost: ${externalTestingInfo.estimated_cost_range || '₹50K - ₹5L'}</div>
        <div>• Labs: ${(externalTestingInfo.labs || ['CPRI', 'ERDA']).join(', ')}</div>
      </div>
    </div>
    ` : ''}
    
    <!-- Terms & Conditions -->
    <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <h4 style="margin: 0 0 10px 0; font-size: 14px;">📜 Terms & Conditions (from RFP)</h4>
      <div style="font-size: 12px; display: grid; gap: 6px;">
        <div>• <strong>Delivery:</strong> ${termsConditions?.deliveryPeriod || 'N/A'}</div>
        <div>• <strong>Payment:</strong> ${termsConditions?.paymentTerms || 'N/A'}</div>
        <div>• <strong>Warranty:</strong> ${termsConditions?.warrantyPeriod || 'N/A'}</div>
        <div>• <strong>LD Clause:</strong> ${termsConditions?.ldClause || 'N/A'}</div>
        <div>• <strong>Inspection:</strong> ${termsConditions?.inspectionRequirements || 'N/A'}</div>
      </div>
    </div>
    
    <!-- Submission Instructions -->
    ${formatSubmissionInstructions(submissionPackage, rfpId)}
    
    <!-- Action Buttons -->
    <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px;">
      ${getSubmissionActionButtons(submissionPackage, rfpId, testingEmail, externalTestingRequired, dueDate)}
      <button onclick="openAnalyzeWorkflow('${rfpId}', ${quotation?.grandTotal || 0})" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px;">
        🤖 View Agent Orchestration
      </button>
    </div>
  </div>
  `;
  
  return html;
}

/**
 * Format submission instructions based on mode
 */
function formatSubmissionInstructions(pkg, rfpId) {
  if (!pkg) return '';
  
  let modeIcon = '📝';
  let modeColor = '#3b82f6';
  
  switch (pkg.mode) {
    case 'Physical Courier': modeIcon = '📮'; modeColor = '#f59e0b'; break;
    case 'Internal Form Fill': modeIcon = '📄'; modeColor = '#8b5cf6'; break;
    case 'Schedule Meeting': modeIcon = '📅'; modeColor = '#06b6d4'; break;
    case 'External Portal Registration': modeIcon = '🌐'; modeColor = '#ec4899'; break;
  }
  
  let html = `
    <div style="background: ${modeColor}22; border: 2px solid ${modeColor}; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: ${modeColor};">${modeIcon} Submission: ${pkg.mode}</h4>
      <div style="font-size: 12px;">
        <strong>Instructions:</strong>
        <ol style="margin: 10px 0; padding-left: 20px;">
          ${(pkg.instructions || []).map(inst => `<li style="margin-bottom: 5px;">${inst}</li>`).join('')}
        </ol>
  `;
  
  // Mode-specific details
  if (pkg.mode === 'Physical Courier' && pkg.postalAddress) {
    html += `
      <div style="background: rgba(0,0,0,0.1); padding: 10px; border-radius: 6px; margin-top: 10px;">
        <strong>📍 Postal Address:</strong><br>
        <pre style="margin: 5px 0; white-space: pre-wrap; font-family: inherit;">${pkg.postalAddress}</pre>
      </div>
    `;
  }
  
  if (pkg.mode === 'External Portal Registration') {
    html += `
      <div style="background: rgba(0,0,0,0.1); padding: 10px; border-radius: 6px; margin-top: 10px;">
        <strong>🌐 Portal URL:</strong> <a href="${pkg.portalUrl}" target="_blank" style="color: ${modeColor};">${pkg.portalUrl}</a><br>
        <strong>📅 Registration Opens:</strong> ${pkg.registrationOpens}<br>
        <strong>📅 Registration Closes:</strong> ${pkg.registrationCloses}
      </div>
    `;
  }
  
  if (pkg.mode === 'Internal Form Fill' && pkg.submissionEmail) {
    html += `
      <div style="background: rgba(0,0,0,0.1); padding: 10px; border-radius: 6px; margin-top: 10px;">
        <strong>📧 Submit To:</strong> ${pkg.submissionEmail}<br>
        <strong>📝 Subject:</strong> ${pkg.emailSubject}
      </div>
    `;
  }
  
  html += `</div></div>`;
  return html;
}

/**
 * Get action buttons based on submission mode
 * 
 * Buttons shown:
 * - Generate Bid PDF: ALWAYS
 * - Deadline Reminder: ALWAYS (all RFPs have deadlines)
 * - Cover Letter: Only for LETTER_COURIER mode
 * - Compose Gmail: For Internal Form Fill or Meeting modes
 * - Registration Reminder: ONLY for EXTERNAL_PORTAL mode
 * - Request Testing Quote: ONLY if externalTestingRequired is true
 */
function getSubmissionActionButtons(pkg, rfpId, testingEmail, externalTestingRequired, dueDate) {
  let buttons = '';
  
  // Common buttons for ALL RFPs
  buttons += `
    <button onclick="generateBidPdf('${rfpId}')" style="background: #059669; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
      📄 Generate Bid PDF
    </button>
  `;
  
  // Download RFP PDF (uses uploaded version if available)
  buttons += `
    <a href="/api/pdf/rfp/${rfpId}" target="_blank" download style="background: #0ea5e9; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; text-decoration: none; display: inline-block;">
      📥 Download RFP PDF
    </a>
  `;
  
  // Deadline reminder - ALWAYS show (all RFPs have deadlines)
  buttons += `
    <button onclick="openCalendarReminder('${rfpId}', 'deadline', '${dueDate || ''}')" style="background: #8b5cf6; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
      📅 Set Deadline Reminder
    </button>
  `;
  
  // Mode-specific buttons
  if (pkg?.mode === 'Physical Courier') {
    buttons += `
      <button onclick="generateCoverLetter('${rfpId}')" style="background: #f59e0b; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        ✉️ Generate Cover Letter
      </button>
    `;
  }
  
  if (pkg?.mode === 'Internal Form Fill' || pkg?.mode === 'Schedule Meeting') {
    const email = pkg.submissionEmail || pkg.meetingEmail || '';
    const subject = pkg.emailSubject || '';
    const body = pkg.emailBody || '';
    // Store email data globally to avoid encoding issues in onclick
    window.pendingEmailData = window.pendingEmailData || {};
    window.pendingEmailData[rfpId] = { to: email, subject: subject, body: body };
    buttons += `
      <button onclick="openStoredGmailCompose('${rfpId}')" style="background: #3b82f6; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        📧 Compose in Gmail
      </button>
    `;
  }
  
  // Registration reminder - ONLY for External Portal mode
  if (pkg?.mode === 'External Portal Registration' && pkg.calendarReminders?.registrationStart) {
    buttons += `
      <button onclick="openCalendarReminder('${rfpId}', 'registration')" style="background: #ec4899; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        📅 Registration Opens Reminder
      </button>
    `;
  }
  
  // Testing email button - ONLY if external testing is required
  if (externalTestingRequired && testingEmail) {
    buttons += `
      <button onclick="openTestingEmail('${rfpId}')" style="background: #6366f1; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        🧪 Request External Testing Quote
      </button>
    `;
  }
  
  return buttons;
}

// ============= INTERACTIVE PREVIEW SYSTEM =============
// Store active drafts for modification
window.activeDrafts = {};
window.currentDraftId = null;
window.currentDraftType = null;

// Helper to show preview box
function showPreviewBox(type, draftId, previewData, instructions) {
  window.currentDraftId = draftId;
  window.currentDraftType = type;
  window.activeDrafts[draftId] = previewData;
  
  const icons = { pdf: '📄', email: '📧', calendar: '📅', testing: '🧪', letter: '✉️' };
  const titles = { pdf: 'Bid PDF Preview', email: 'Email Preview', calendar: 'Calendar Event Preview', testing: 'Testing Quote Preview', letter: 'Cover Letter Preview' };
  
  let fieldsHtml = '';
  for (const [key, value] of Object.entries(previewData.fields || {})) {
    // Show full body for email/testing, truncate others
    const isBodyField = key.toLowerCase() === 'body' || key.toLowerCase() === 'message';
    const displayVal = typeof value === 'string' 
      ? (isBodyField ? value.replace(/\n/g, '<br>') : value.substring(0, 150) + (value.length > 150 ? '...' : '')) 
      : value;
    const maxHeight = isBodyField ? 'max-height: 200px; overflow-y: auto;' : '';
    fieldsHtml += `<div style="margin: 8px 0; padding: 8px; background: #f1f5f9; border-radius: 6px; border-left: 3px solid #3b82f6; ${maxHeight}">
      <strong style="color: #334155;">${key}:</strong> <span style="color: #64748b;">${displayVal}</span>
    </div>`;
  }
  
  const html = `
    <div style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border: 2px solid #0ea5e9; border-radius: 12px; padding: 20px; margin: 10px 0;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
        <span style="font-size: 28px;">${icons[type]}</span>
        <h3 style="margin: 0; color: #0369a1; font-size: 18px;">${titles[type]}</h3>
        <span style="background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">DRAFT - Review Before Proceeding</span>
      </div>
      
      <div style="background: white; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
        ${fieldsHtml}
      </div>
      
      <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 12px; margin-bottom: 15px;">
        <div style="font-weight: 600; color: #047857; margin-bottom: 8px;">✏️ Want to make changes? Type:</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #065f46;">
          ${instructions.map(i => `<li style="margin: 4px 0;">"${i}"</li>`).join('')}
        </ul>
      </div>
      
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button onclick="confirmDraft('${draftId}')" style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;">
          ✅ Confirm & Proceed
        </button>
        <button onclick="cancelDraft('${draftId}')" style="background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;">
          ❌ Cancel
        </button>
      </div>
    </div>
  `;
  
  addMessage(html, false);
}

// Confirm and execute draft
window.confirmDraft = function(draftId) {
  const draft = window.activeDrafts[draftId];
  if (!draft) {
    addMessage('❌ Draft not found. Please try again.');
    return;
  }
  
  addLoadingMessage('Processing...');
  
  if (draft.type === 'pdf') {
    executePdfGeneration(draft);
  } else if (draft.type === 'email' || draft.type === 'testing') {
    executeEmailCompose(draft);
  } else if (draft.type === 'calendar') {
    executeCalendarAdd(draft);
  } else if (draft.type === 'letter') {
    executeCoverLetter(draft);
  } else if (draft.type === 'printable-letter') {
    executePrintableLetterPDF(draft);
  }
  
  // Clean up
  delete window.activeDrafts[draftId];
  window.currentDraftId = null;
  window.currentDraftType = null;
};

// Cancel draft
window.cancelDraft = function(draftId) {
  delete window.activeDrafts[draftId];
  window.currentDraftId = null;
  window.currentDraftType = null;
  addMessage('❌ Draft cancelled. Let me know if you need anything else!', false);
};

// Execute PDF generation
function executePdfGeneration(draft) {
  // Build proper company details from draft fields
  const companyDetails = {
    name: draft.fields?.['Company'] || draft.companyDetails?.name || 'Cable Solutions Pvt Ltd',
    contact_person: draft.fields?.['Contact Person'] || draft.companyDetails?.contact_person || 'Sales Manager',
    email: draft.fields?.['Email'] || draft.companyDetails?.email || 'sales@cablesolutions.com',
    phone: draft.companyDetails?.phone || '+91 22 1234 5678',
    address: draft.companyDetails?.address || '123 Industrial Area, Phase II\nGurgaon, Haryana 122001, India',
    gstin: draft.companyDetails?.gstin || '06AABCU9603R1ZM',
    pan: draft.companyDetails?.pan || 'AABCU9603R'
  };
  
  console.log('Generating PDF with company details:', companyDetails);
  
  // Include quotation if available in draft
  const requestBody = { 
    tenderId: draft.tenderId,
    companyDetails: companyDetails
  };
  
  // Pass quotation if available to avoid recalculation
  if (draft.quotation) {
    requestBody.quotation = draft.quotation;
  }
  
  fetch('/api/rfp-proceed/generate-bid-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(err => {
        throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`);
      });
    }
    return res.json();
  })
  .then(data => {
    removeLastMessage();
    if (data.success) {
      const link = document.createElement('a');
      link.href = 'data:application/pdf;base64,' + data.pdf;
      link.download = data.filename;
      link.click();
      addMessage('✅ Bid PDF generated and downloaded with your modifications!', false);
    } else {
      addMessage(`❌ Error: ${data.error || 'Failed to generate PDF'}`, false);
    }
  })
  .catch(error => {
    console.error('PDF Generation Error:', error);
    removeLastMessage();
    addMessage(`❌ Error generating PDF: ${error.message || 'Unknown error occurred. Please try again.'}`, false);
  });
}

// Execute email compose
function executeEmailCompose(draft) {
  removeLastMessage();
  const to = encodeURIComponent(draft.fields.To || draft.fields.Recipient || '');
  const subject = encodeURIComponent(draft.fields.Subject || '');
  
  // Get body and replace any contact person references if modified
  let body = draft.fields.Body || draft.fields.Message || '';
  
  // If contact person was modified, update it in the body
  if (draft.modifiedContactPerson) {
    body = body.replace(/Sales Manager/g, draft.modifiedContactPerson);
    body = body.replace(/Rajesh Kumar/g, draft.modifiedContactPerson);
  }
  
  const encodedBody = encodeURIComponent(body);
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${encodedBody}`;
  window.open(url, '_blank');
  addMessage('✅ Gmail compose window opened with your customized content!', false);
}

// Execute calendar add
function executeCalendarAdd(draft) {
  removeLastMessage();
  const title = encodeURIComponent(draft.fields.Title || 'Reminder');
  const eventDate = new Date(draft.fields.Date);
  const reminderDays = draft.reminderDays || 1;
  const reminderDate = new Date(eventDate.getTime() - reminderDays * 24 * 60 * 60 * 1000);
  const endDate = new Date(reminderDate.getTime() + 60 * 60 * 1000);
  const formatGCalDate = (d) => d.toISOString().replace(/-|:|\.\d+/g, '');
  const description = encodeURIComponent(draft.fields.Notes || draft.fields.Description || '');
  
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatGCalDate(reminderDate)}/${formatGCalDate(endDate)}&details=${description}`;
  window.open(gcalUrl, '_blank');
  addMessage('✅ Google Calendar opened with your customized event!', false);
}

// Execute cover letter
function executeCoverLetter(draft) {
  // Build proper company details from draft fields
  const companyDetails = {
    name: draft.fields?.['From Company'] || draft.companyDetails?.name || 'Cable Solutions Pvt Ltd',
    contact_person: draft.fields?.['Contact Person'] || draft.companyDetails?.contact_person || 'Sales Manager',
    designation: draft.fields?.['Designation'] || draft.companyDetails?.designation || 'Managing Director',
    email: draft.companyDetails?.email || 'sales@cablesolutions.com',
    phone: draft.companyDetails?.phone || '+91 22 1234 5678',
    address: draft.companyDetails?.address || '123 Industrial Area, Phase II\nGurgaon, Haryana 122001, India',
    gstin: draft.companyDetails?.gstin || '06AABCU9603R1ZM',
    pan: draft.companyDetails?.pan || 'AABCU9603R'
  };
  
  console.log('Generating cover letter with company details:', companyDetails);
  
  fetch('/api/rfp-proceed/generate-cover-letter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      tenderId: draft.tenderId,
      companyDetails: companyDetails 
    })
  })
  .then(res => res.json())
  .then(data => {
    removeLastMessage();
    if (data.success) {
      const link = document.createElement('a');
      link.href = 'data:application/pdf;base64,' + data.pdf;
      link.download = data.filename;
      link.click();
      addMessage('✅ Cover letter generated and downloaded with your modifications!', false);
    } else {
      addMessage(`❌ Error: ${data.error}`, false);
    }
  });
}

// Modify current draft based on user input
window.modifyCurrentDraft = function(instruction) {
  if (!window.currentDraftId || !window.activeDrafts[window.currentDraftId]) {
    return false;
  }
  
  const draft = window.activeDrafts[window.currentDraftId];
  const instr = instruction.toLowerCase();
  let modified = false;
  draft.changedFields = draft.changedFields || [];
  
  // =========== AI MODIFICATION CHECK FIRST ===========
  // For email/testing drafts, check if this is a complex AI request FIRST
  // before trying simple pattern matching
  if ((draft.type === 'email' || draft.type === 'testing') && draft.fields.Body) {
    const aiTriggerPatterns = [
      // Tone changes
      /(?:make|want)\s+(?:it|the\s+email)?\s*(?:more\s+|a\s+bit\s+|bit\s+|little\s+)?(?:formal|informal|polite|casual|professional|friendly|urgent|shorter|longer)/i,
      /(?:too|bit)\s+(?:formal|informal|polite|casual)/i,
      // Mention people
      /mention\s+(?:miss|mr|mrs|ms|dr)?\.?\s*[A-Za-z]/i,
      /connect\s+(?:us\s+)?(?:with|to)\s+[A-Za-z]/i,
      /(?:miss|mr|mrs|ms)\s+[A-Za-z]+.*(?:mediator|contact|input|assistance)/i,
      // Complex instructions (long with context)
      /(?:she|he|they)\s+(?:has|have)\s+been/i,
      /(?:her|his|their)\s+(?:input|help|assistance)/i,
      /(?:mediator|coordinate|point\s+of\s+contact)/i,
      /we\s+(?:have\s+)?contacted.*before/i,
      // Content modifications
      /rewrite|rephrase|improve\s+the|change\s+the\s+tone/i,
      /add\s+(?:a\s+)?(?:mention|note|paragraph|reference|section)/i,
      /emphasize|highlight|focus\s+on/i,
      /remove|delete|take\s+out/i,
      /shorten|expand|elaborate/i
    ];
    
    // Long complex instructions (more than 40 chars and has multiple clauses)
    const isComplexRequest = instruction.length > 40 && 
      (instruction.includes(',') || instruction.includes('.') || instruction.includes(' and ') || instruction.includes(' also '));
    
    const isAIRequest = aiTriggerPatterns.some(p => p.test(instruction)) || isComplexRequest;
    
    if (isAIRequest) {
      console.log('🤖 AI modification triggered for:', instruction.substring(0, 50) + '...');
      draft.pendingAIModification = instruction;
      window.activeDrafts[window.currentDraftId] = draft;
      performAIEmailModification(draft, instruction);
      return true; // Handled asynchronously
    }
  }
  
  // =========== CALENDAR EVENT MODIFICATIONS ===========
  if (draft.type === 'calendar') {
    // Reminder changes: "set reminder to 2 days before", "reminder 3 days"
    if (instr.includes('reminder') || instr.includes('days before')) {
      const daysMatch = instruction.match(/(\d+)\s*days?\s*(?:before)?/i);
      if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        draft.fields.Reminder = `${days} day${days > 1 ? 's' : ''} before`;
        draft.reminderDays = days;
        draft.changedFields = draft.changedFields || [];
        draft.changedFields.push('Reminder');
        window.activeDrafts[window.currentDraftId] = draft;
        showDraftUpdateSuccess(draft, ['Reminder']);
        return true;
      }
    }
    
    // Date changes: "set reminder for 4th jan 2027", "change date to 2027-01-04"
    if (instr.includes('date') || instr.includes('for ') || instr.includes('on ')) {
      // Try various date formats
      let newDate = null;
      
      // ISO format: 2027-01-04
      const isoMatch = instruction.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) {
        newDate = new Date(isoMatch[1]);
      }
      
      // Natural format: "4th jan 2027", "jan 4 2027", "january 4, 2027"
      if (!newDate || isNaN(newDate)) {
        const naturalMatch = instruction.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?([a-z]+)\s*(\d{4})/i);
        if (naturalMatch) {
          const day = parseInt(naturalMatch[1]);
          const monthStr = naturalMatch[2].toLowerCase();
          const year = parseInt(naturalMatch[3]);
          const months = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
            apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
            aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
            nov: 10, november: 10, dec: 11, december: 11
          };
          if (months.hasOwnProperty(monthStr)) {
            newDate = new Date(year, months[monthStr], day, 12, 0, 0);
          }
        }
      }
      
      // Another format: "jan 4th 2027"
      if (!newDate || isNaN(newDate)) {
        const altMatch = instruction.match(/([a-z]+)\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})/i);
        if (altMatch) {
          const monthStr = altMatch[1].toLowerCase();
          const day = parseInt(altMatch[2]);
          const year = parseInt(altMatch[3]);
          const months = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
            apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
            aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
            nov: 10, november: 10, dec: 11, december: 11
          };
          if (months.hasOwnProperty(monthStr)) {
            newDate = new Date(year, months[monthStr], day, 12, 0, 0);
          }
        }
      }
      
      if (newDate && !isNaN(newDate)) {
        draft.fields.Date = newDate.toISOString();
        draft.date = newDate.toISOString();
        draft.changedFields = draft.changedFields || [];
        draft.changedFields.push('Date');
        window.activeDrafts[window.currentDraftId] = draft;
        showDraftUpdateSuccess(draft, ['Date']);
        return true;
      }
    }
    
    // Title changes
    if (instr.includes('title')) {
      let titleValue = null;
      
      // Try quoted value first: title to "New Event Title"
      const quotedMatch = instruction.match(/title\s+(?:to\s+)?["']([^"']+)["']/i);
      if (quotedMatch) {
        titleValue = quotedMatch[1].trim();
      }
      
      // Unquoted pattern
      if (!titleValue) {
        const titleMatch = instruction.match(/title\s+(?:to\s+)?(.+)/i);
        if (titleMatch) {
          titleValue = titleMatch[1].trim();
          // Remove surrounding quotes if present
          titleValue = titleValue.replace(/^["']|["']$/g, '');
        }
      }
      
      if (titleValue) {
        draft.fields.Title = titleValue;
        draft.title = titleValue;
        draft.changedFields = draft.changedFields || [];
        draft.changedFields.push('Title');
        window.activeDrafts[window.currentDraftId] = draft;
        showDraftUpdateSuccess(draft, ['Title']);
        return true;
      }
    }
    
    // Notes changes
    if (instr.includes('note')) {
      let notesValue = null;
      
      // Try quoted value first: notes to "Some important notes"
      const quotedMatch = instruction.match(/note[s]?\s+(?:to\s+)?["']([^"']+)["']/i);
      if (quotedMatch) {
        notesValue = quotedMatch[1].trim();
      }
      
      // Unquoted pattern
      if (!notesValue) {
        const notesMatch = instruction.match(/note[s]?\s+(?:to\s+)?(.+)/i);
        if (notesMatch) {
          notesValue = notesMatch[1].trim();
          // Remove surrounding quotes if present
          notesValue = notesValue.replace(/^["']|["']$/g, '');
        }
      }
      
      if (notesValue) {
        draft.fields.Notes = notesValue;
        draft.description = notesValue;
        draft.changedFields = draft.changedFields || [];
        draft.changedFields.push('Notes');
        window.activeDrafts[window.currentDraftId] = draft;
        showDraftUpdateSuccess(draft, ['Notes']);
        return true;
      }
    }
  }
  
  // =========== SMART FIELD DETECTION ===========
  // Handles multiple patterns:
  // 1. "[Field] [Value]" - e.g., "Designation General Manager"
  // 2. "change [field] to [value]" - e.g., "change designation to GM"
  // 3. "[field] change to [value]" - e.g., "tender reference change to UTL-317"
  
  // Designation changes - FIRST CHECK (before contact person)
  if (instr.includes('designation')) {
    let desigValue = null;
    
    // Try quoted value first: designation to "General Manager"
    const quotedMatch = instruction.match(/designation\s+(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      desigValue = quotedMatch[1].trim();
    }
    
    // Pattern 1: "Designation [Value]" (direct)
    if (!desigValue) {
      const directMatch = instruction.match(/designation\s+(?:to\s+)?([A-Za-z\s]+?)(?:\s+in|\s*$|\.)/i);
      if (directMatch && !directMatch[1].toLowerCase().includes('change')) {
        desigValue = directMatch[1].trim();
      }
    }
    
    // Pattern 2: "change designation to [Value]"
    if (!desigValue) {
      const changeMatch = instruction.match(/change\s+designation\s+(?:to\s+)?([A-Za-z\s]+?)(?:\s+in|\s*$|\.)/i);
      if (changeMatch) {
        desigValue = changeMatch[1].trim();
      }
    }
    
    if (desigValue && desigValue.length > 1 && !['to', 'change', 'the'].includes(desigValue.toLowerCase())) {
      draft.fields.Designation = desigValue;
      draft.companyDetails = draft.companyDetails || {};
      draft.companyDetails.designation = desigValue;
      draft.changedFields.push('Designation');
      modified = true;
      console.log('Modified designation to:', desigValue);
    }
  }
  
  // Tender Reference changes
  if (!modified && (instr.includes('tender') || instr.includes('reference'))) {
    let refValue = null;
    
    // Try quoted value first: reference to "UTL-317"
    const quotedMatch = instruction.match(/(?:tender\s+)?reference\s+(?:change\s+)?(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      refValue = quotedMatch[1].trim().toUpperCase();
    }
    
    // Pattern: "tender reference change to UTL-317" or "tender reference UTL-317"
    if (!refValue) {
      const refMatch = instruction.match(/(?:tender\s+)?reference\s+(?:change\s+to\s+|to\s+)?([A-Z0-9-]+)/i);
      if (refMatch) {
        refValue = refMatch[1].trim().toUpperCase();
      }
    }
    
    // Pattern: "change tender reference to UTL-317"
    if (!refValue) {
      const changeRefMatch = instruction.match(/change\s+(?:tender\s+)?reference\s+(?:to\s+)?([A-Z0-9-]+)/i);
      if (changeRefMatch) {
        refValue = changeRefMatch[1].trim().toUpperCase();
      }
    }
    
    if (refValue && refValue.length >= 3) {
      draft.fields['Tender Reference'] = refValue;
      draft.tenderId = refValue;
      draft.changedFields.push('Tender Reference');
      modified = true;
      console.log('Modified tender reference to:', refValue);
    }
  }
  
  // Contact person changes - multiple patterns
  // Patterns: "contact person to Arnav", "change name to Arnav", "Contact Person Arnav Kadhe"
  if (!modified && (instr.includes('contact person') || instr.includes('contact name') || 
      (instr.includes('name') && !instr.includes('company name')))) {
    let nameValue = null;
    
    // Try quoted value first: contact person to "Arnav Kadhe"
    const quotedMatch = instruction.match(/contact\s+(?:person|name)\s+(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      nameValue = quotedMatch[1].trim();
    }
    
    // Also try quoted for "name to "Value""
    if (!nameValue) {
      const quotedNameMatch = instruction.match(/name\s+(?:to\s+)?["']([^"']+)["']/i);
      if (quotedNameMatch) {
        nameValue = quotedNameMatch[1].trim();
      }
    }
    
    // Pattern: "Contact Person [Name]" or "contact person to [Name]"
    if (!nameValue) {
      const contactMatch = instruction.match(/contact\s+(?:person|name)\s+(?:to\s+)?([A-Za-z\s]+?)(?:\s+in\s+|\s+for\s+|\s*$|\.)/i);
      if (contactMatch) {
        nameValue = contactMatch[1].trim();
      }
    }
    
    // Pattern: "change name to [Name]" (when in context of draft)
    if (!nameValue) {
      const nameMatch = instruction.match(/(?:change\s+)?name\s+(?:to\s+)?([A-Za-z\s]+?)(?:\s+in\s+|\s+for\s+|\s*$|\.)/i);
      if (nameMatch) {
        nameValue = nameMatch[1].trim();
      }
    }
    
    if (nameValue && nameValue.length > 1) {
      draft.companyDetails = draft.companyDetails || {};
      draft.companyDetails.contact_person = nameValue;
      draft.fields['Contact Person'] = nameValue;
      draft.modifiedContactPerson = nameValue;
      draft.changedFields.push('Contact Person');
      modified = true;
      console.log('Modified contact person to:', nameValue);
    }
  }
  
  // Company name changes
  // Patterns: "Company ABC Ltd", "change company to XYZ", "from company to ABC", "company to "XYZ""
  // Also handles typos like "comapny", "compnay", "campany"
  const companyTypos = instr.includes('company') || instr.includes('comapny') || 
                       instr.includes('compnay') || instr.includes('campany') ||
                       instr.includes('firm') || instr.includes('from company') ||
                       instr.includes('from comapny');
  
  if (!modified && companyTypos) {
    let companyValue = null;
    
    // First try quoted value: company name to "XYZ" or company to "ABC Ltd" or from company to "XYZ"
    const quotedMatch = instruction.match(/(?:from\s+)?(?:company|comapny|compnay|campany|firm)\s+(?:name\s+)?(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      companyValue = quotedMatch[1].trim();
    }
    
    // If no quoted match, try unquoted: company name to XYZ or from company ABC Ltd
    if (!companyValue) {
      const unquotedMatch = instruction.match(/(?:from\s+)?(?:company|comapny|compnay|campany|firm)\s+(?:name\s+)?(?:to\s+)?([A-Za-z0-9\s&.,]+?)(?:\s+in\s|\s*$|\.)/i);
      if (unquotedMatch) {
        companyValue = unquotedMatch[1].trim();
      }
    }
    
    // Clean up - remove trailing words like "in", "for", etc.
    if (companyValue) {
      companyValue = companyValue.replace(/\s+(in|for|to|the)$/i, '').trim();
    }
    
    if (companyValue && companyValue.length >= 2) {
      draft.companyDetails = draft.companyDetails || {};
      draft.companyDetails.name = companyValue;
      draft.fields['Company'] = companyValue;
      draft.fields['From Company'] = companyValue;
      draft.changedFields.push('Company');
      modified = true;
      console.log('Modified company to:', companyValue);
    }
  }
  
  // Subject changes
  if (!modified && instr.includes('subject')) {
    let subjectValue = null;
    
    // Try quoted value first: subject to "New Subject"
    const quotedMatch = instruction.match(/subject\s+(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      subjectValue = quotedMatch[1].trim();
    }
    
    // Unquoted pattern
    if (!subjectValue) {
      const subjectMatch = instruction.match(/subject\s+(?:to\s+)?(.+)/i);
      if (subjectMatch) {
        subjectValue = subjectMatch[1].trim();
      }
    }
    
    if (subjectValue) {
      // Remove surrounding quotes if present
      subjectValue = subjectValue.replace(/^["']|["']$/g, '');
      draft.fields.Subject = subjectValue;
      draft.changedFields.push('Subject');
      modified = true;
    }
  }
  
  // Recipient/Email changes
  if (!modified && (instr.includes('recipient') || instr.includes('send to') || instr.includes('email to'))) {
    const emailMatch = instruction.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) {
      draft.fields.To = emailMatch[0];
      draft.fields.Recipient = emailMatch[0];
      draft.changedFields.push('To');
      modified = true;
    }
  }
  
  // Title changes
  if (!modified && instr.includes('title')) {
    let titleValue = null;
    
    // Try quoted value first: title to "New Title"
    const quotedMatch = instruction.match(/title\s+(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      titleValue = quotedMatch[1].trim();
    }
    
    // Unquoted pattern
    if (!titleValue) {
      const titleMatch = instruction.match(/title\s+(?:to\s+)?(.+)/i);
      if (titleMatch) {
        titleValue = titleMatch[1].trim();
        // Remove surrounding quotes if present
        titleValue = titleValue.replace(/^["']|["']$/g, '');
      }
    }
    
    if (titleValue) {
      draft.fields.Title = titleValue;
      draft.changedFields.push('Title');
      modified = true;
    }
  }
  
  // Date changes
  if (!modified && (instr.includes('date') && (instr.includes('change') || instr.includes('set')))) {
    const dateMatch = instruction.match(/(?:date\s+to|to)\s+(.+)/i);
    if (dateMatch) {
      const parsed = new Date(dateMatch[1].trim());
      if (!isNaN(parsed)) {
        draft.fields.Date = parsed.toISOString().split('T')[0];
        draft.changedFields.push('Date');
        modified = true;
      }
    }
  }
  
  // Body changes - multiple patterns
  if (!modified && instr.includes('body')) {
    // Pattern: "change body to [full text]"
    const bodyMatch = instruction.match(/(?:change\s+)?body\s+(?:to\s+)?(.+)/is);
    if (bodyMatch && bodyMatch[1].trim().length > 10) {
      draft.fields.Body = bodyMatch[1].trim();
      draft.changedFields.push('Body');
      modified = true;
      console.log('Modified body');
    }
    
    // Pattern: "change name in body to [name]"
    if (!modified && instr.includes('name')) {
      const nameMatch = instruction.match(/name\s+(?:in\s+body\s+)?(?:to\s+)?([A-Za-z\s]+?)(?:\s+in|\s*$|\.)/i);
      if (nameMatch && draft.fields.Body) {
        const newName = nameMatch[1].trim();
        draft.fields.Body = draft.fields.Body
          .replace(/Rajesh Kumar/g, newName)
          .replace(/Sales Manager/g, newName)
          .replace(/Contact:\s*[A-Za-z\s]+/g, `Contact: ${newName}`);
        draft.modifiedContactPerson = newName;
        draft.changedFields.push('Body');
        modified = true;
      }
    }
  }
  
  // (AI modification check moved to top of function)
  
  // Add to body / append
  if (!modified && (instr.includes('add to body') || instr.includes('append'))) {
    const textMatch = instruction.replace(/add to body[:\s]*/i, '').replace(/append[:\s]*/i, '').trim();
    if (textMatch && draft.fields.Body) {
      draft.fields.Body += '\n\n' + textMatch;
      draft.changedFields.push('Body');
      modified = true;
    }
  }
  
  // Email address changes - handle "change email to X"
  if (!modified && instr.includes('email') && !instr.includes('body')) {
    let emailValue = null;
    
    // Try quoted value first: email to "test@example.com"
    const quotedMatch = instruction.match(/email\s+(?:to\s+)?["']([^"']+)["']/i);
    if (quotedMatch) {
      emailValue = quotedMatch[1].trim();
    }
    
    // Unquoted pattern
    if (!emailValue) {
      const emailMatch = instruction.match(/email\s+(?:to\s+)?([^\s]+@[^\s]+|[A-Za-z0-9]+)/i);
      if (emailMatch) {
        emailValue = emailMatch[1].trim();
      }
    }
    
    if (emailValue && emailValue.includes('@')) {
      draft.fields.Email = emailValue;
      draft.fields.To = emailValue;
      draft.companyDetails = draft.companyDetails || {};
      draft.companyDetails.email = emailValue;
      draft.changedFields.push('Email');
      modified = true;
    }
  }
  
  // Generic "change X as well" or "this as well" - apply last change again
  if (!modified && (instr.includes('as well') || instr.includes('this too') || instr.includes('same'))) {
    // Try to apply the last successful modification pattern
    if (draft.lastModification) {
      const { field, value } = draft.lastModification;
      if (field === 'Contact Person' && draft.fields.Designation) {
        draft.fields.Designation = value;
        draft.companyDetails.designation = value;
        draft.changedFields.push('Designation');
        modified = true;
      }
    }
  }
  
  // Store last modification for "as well" patterns
  if (modified && draft.changedFields.length > 0) {
    const lastField = draft.changedFields[draft.changedFields.length - 1];
    draft.lastModification = {
      field: lastField,
      value: draft.fields[lastField] || draft.companyDetails?.[lastField.toLowerCase().replace(' ', '_')]
    };
  }
  
  if (modified) {
    window.activeDrafts[window.currentDraftId] = draft;
    
    // Show updated preview with highlighted changes
    let fieldsHtml = '';
    for (const [key, value] of Object.entries(draft.fields || {})) {
      const isBodyField = key.toLowerCase() === 'body' || key.toLowerCase() === 'message';
      const displayVal = typeof value === 'string' 
        ? (isBodyField ? value.substring(0, 100) + '...' : value.substring(0, 80) + (value.length > 80 ? '...' : '')) 
        : value;
      const isChanged = draft.changedFields?.includes(key);
      fieldsHtml += `<div style="margin: 6px 0; padding: 8px; background: ${isChanged ? '#dcfce7' : '#f1f5f9'}; border-radius: 4px; border-left: 3px solid ${isChanged ? '#10b981' : '#94a3b8'};">
        <strong style="color: #334155;">${key}:</strong> <span style="color: ${isChanged ? '#047857' : '#64748b'};">${displayVal}</span> ${isChanged ? '<span style="color: #10b981; font-weight: 600;">✓ Updated</span>' : ''}
      </div>`;
    }
    
    addMessage(`
      <div style="background: linear-gradient(135deg, #ecfdf5, #d1fae5); border: 2px solid #10b981; border-radius: 12px; padding: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="font-size: 24px;">✅</span>
          <span style="font-weight: 600; color: #047857; font-size: 16px;">Draft Updated Successfully!</span>
        </div>
        <div style="background: white; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
          ${fieldsHtml}
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px; font-size: 13px; color: #166534;">
          <strong>Next:</strong> Say <span style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">"proceed"</span> or <span style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">"confirm"</span> to continue, or describe more changes.
        </div>
      </div>
    `, false);
    
    return true;
  }
  
  return false;
};

// Check for proceed/confirm commands
window.checkDraftCommands = function(message) {
  const msg = message.toLowerCase().trim();
  
  if (window.currentDraftId) {
    // Proceed/confirm commands
    if (msg === 'proceed' || msg === 'confirm' || msg === 'yes' || msg === 'ok' || msg === 'send' || msg === 'generate' || msg === 'download') {
      window.confirmDraft(window.currentDraftId);
      return true;
    }
    // Cancel commands
    if (msg === 'cancel' || msg === 'no' || msg === 'discard') {
      window.cancelDraft(window.currentDraftId);
      return true;
    }
    
    // ============ AGGRESSIVE DRAFT MODIFICATION DETECTION ============
    // When a draft is active, MOST messages should be treated as modifications
    // unless they're clearly new search queries
    
    // Check if this looks like a modification request (not a search)
    const isLikelyModification = detectModificationIntent(message);
    
    if (isLikelyModification) {
      if (window.modifyCurrentDraft(message)) {
        return true;
      }
      // If modification failed, show help
      showModificationHelp();
      return true;
    }
  }
  return false;
};

// Detect if message is likely a modification request vs new search
function detectModificationIntent(message) {
  const msg = message.toLowerCase().trim();
  const draft = window.activeDrafts[window.currentDraftId];
  if (!draft) return false;
  
  // Keywords that indicate modification intent
  const modificationKeywords = [
    'change', 'modify', 'update', 'set', 'make', 'edit',
    'contact', 'company', 'name', 'designation', 'title', 'subject',
    'email', 'recipient', 'body', 'date', 'to ', 'as well', 'this too',
    'tender reference', 'from company',
    // Calendar-specific
    'reminder', 'days before', 'day before', 'notes', 'for ', 'on '
  ];
  
  // Keywords that indicate search intent
  const searchKeywords = [
    'find', 'search', 'show', 'list', 'get', 'cables in', 
    'ht cable', 'lt cable', 'control cable', 'ehv', 'instrumentation',
    'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'pune',
    'rfps', 'tenders'
  ];
  
  // Check for search keywords first
  for (const kw of searchKeywords) {
    if (msg.includes(kw) && !msg.includes('change') && !msg.includes('modify')) {
      // Looks like a search, but check if it references draft fields
      const draftFields = Object.keys(draft.fields || {}).map(k => k.toLowerCase());
      const referencesField = draftFields.some(f => msg.includes(f));
      if (!referencesField) {
        return false; // Likely a new search
      }
    }
  }
  
  // Check for modification keywords
  for (const kw of modificationKeywords) {
    if (msg.includes(kw)) {
      return true;
    }
  }
  
  // Check if message contains field names from current draft
  const draftFields = Object.keys(draft.fields || {}).map(k => k.toLowerCase());
  for (const field of draftFields) {
    if (msg.includes(field)) {
      return true;
    }
  }
  
  // Pattern: "[FieldName] [Value]" - short message with capitalized words
  if (msg.split(' ').length <= 6 && /^[a-z]+\s+[A-Za-z\s]+$/i.test(message.trim())) {
    const firstWord = msg.split(' ')[0];
    if (['designation', 'company', 'contact', 'name', 'email', 'subject', 'title', 'tender', 'reference'].includes(firstWord)) {
      return true;
    }
  }
  
  return false;
}

// Show draft update success message
function showDraftUpdateSuccess(draft, changedFields) {
  const fieldsList = changedFields.map(f => {
    const value = draft.fields[f] || draft[f.toLowerCase()] || 'Updated';
    return `<strong>${f}:</strong> ${value}`;
  }).join('<br>');
  
  addMessage(`
    <div style="background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid #10b981; border-radius: 12px; padding: 16px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <span style="font-size: 20px;">✅</span>
        <span style="font-weight: 600; color: #047857;">Draft Updated Successfully!</span>
      </div>
      <div style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
        ${fieldsList}
      </div>
      <div style="font-size: 13px; color: #166534;">
        <strong>Next:</strong> Say <span style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">"proceed"</span> or <span style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">"confirm"</span> to continue, or describe more changes.
      </div>
    </div>
  `, false);
}

// Show help when modification fails
function showModificationHelp() {
  const draft = window.activeDrafts[window.currentDraftId];
  const fields = Object.keys(draft?.fields || {}).join(', ');
  const isEmail = draft?.type === 'email' || draft?.type === 'testing';
  
  let aiExamples = '';
  if (isEmail) {
    aiExamples = `
      <p style="margin: 8px 0 0 0; font-size: 13px; color: #7c3aed;">
        <strong>🤖 AI-Powered Email Changes:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 20px;">
          <li>"make it more formal"</li>
          <li>"make it more polite and professional"</li>
          <li>"mention Mr. Sharma as the key decision maker"</li>
          <li>"add urgency about the deadline"</li>
          <li>"shorten the email"</li>
          <li>"rewrite in a more friendly tone"</li>
        </ul>
      </p>`;
  }
  
  addMessage(`
    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; color: #92400e;">
      <strong>⚠️ I couldn't understand that modification.</strong>
      <p style="margin: 8px 0 0 0; font-size: 13px;">
        Currently editable fields: <strong>${fields}</strong>
      </p>
      <p style="margin: 8px 0 0 0; font-size: 13px;">
        <strong>Field Changes:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 20px;">
          <li>"Contact Person Arnav Kadhe"</li>
          <li>"change designation to General Manager"</li>
          <li>"Company name ABC Ltd"</li>
        </ul>
      </p>
      ${aiExamples}
      <p style="margin: 8px 0 0 0; font-size: 13px;">
        Say <strong>"proceed"</strong> to continue or <strong>"cancel"</strong> to discard.
      </p>
    </div>
  `, false);
}

// ============= AI-POWERED EMAIL MODIFICATION =============

// Perform AI email modification
async function performAIEmailModification(draft, instruction) {
  addLoadingMessage('🤖 AI is modifying your email...');
  
  try {
    const response = await fetch('/api/rfp-proceed/ai-modify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentEmail: {
          to: draft.fields.To || draft.fields.Recipient || '',
          subject: draft.fields.Subject || '',
          body: draft.fields.Body || draft.fields.Message || ''
        },
        instruction: instruction,
        context: {
          tenderId: draft.tenderId,
          companyName: draft.companyDetails?.name || 'Cable Solutions Pvt Ltd',
          contactPerson: draft.companyDetails?.contact_person || 'Rajesh Kumar'
        }
      })
    });
    
    const result = await response.json();
    removeLastMessage();
    
    // Check for quota/overload errors
    const errorMsg = result.error || '';
    const isQuotaError = errorMsg.includes('503') || errorMsg.includes('overload') || 
                         errorMsg.includes('UNAVAILABLE') || errorMsg.includes('quota') ||
                         errorMsg.includes('exhausted');
    
    if (result.success && result.body) {
      // Update draft with AI modifications
      if (result.subject) draft.fields.Subject = result.subject;
      draft.fields.Body = result.body;
      draft.fields.Message = result.body;
      draft.changedFields = draft.changedFields || [];
      draft.changedFields.push('Body (AI Modified)');
      draft.pendingAIModification = null;
      
      window.activeDrafts[window.currentDraftId] = draft;
      
      // Show updated preview
      showAIModifiedPreview(draft, result.changes || ['Email modified'], instruction);
    } else if (isQuotaError) {
      // Gemini quota exhausted - show clear message
      addMessage(`
        <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 12px; padding: 16px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 28px;">⚠️</span>
            <span style="font-weight: 700; color: #92400e; font-size: 16px;">Gemini API Quota Exhausted</span>
          </div>
          <p style="color: #78350f; margin-bottom: 12px;">
            The AI email modification feature requires the Gemini API, which has hit its daily limit.
          </p>
          <div style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <p style="font-weight: 600; color: #92400e; margin-bottom: 8px;">🔄 Options:</p>
            <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 13px;">
              <li><strong>Wait until tomorrow</strong> - Quota resets at midnight Pacific Time</li>
              <li><strong>Use simple changes</strong> - Try "change subject to X" or "change contact to Y"</li>
              <li><strong>Proceed as-is</strong> - Say "proceed" to open Gmail with current content</li>
            </ul>
          </div>
          <p style="font-size: 12px; color: #92400e;">
            💡 Simple field changes (subject, recipient, contact) still work without AI!
          </p>
        </div>
      `, false);
    } else {
      addMessage(`
        <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
          <strong>❌ AI modification failed:</strong> ${result.error || 'Unknown error'}
          <p style="margin: 8px 0 0 0; font-size: 13px;">
            Try a simpler instruction like "change subject to X" or say <strong>"proceed"</strong> to continue with current draft.
          </p>
        </div>
      `, false);
    }
  } catch (error) {
    removeLastMessage();
    const isQuotaError = error.message && (error.message.includes('503') || error.message.includes('overload'));
    
    if (isQuotaError) {
      addMessage(`
        <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 12px; padding: 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">⚠️</span>
            <span style="font-weight: 700; color: #92400e;">Gemini API Unavailable</span>
          </div>
          <p style="color: #78350f; margin-top: 8px;">Quota exhausted. Use simple changes or try tomorrow!</p>
        </div>
      `, false);
    } else {
      addMessage(`
        <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
          <strong>❌ Error:</strong> ${error.message}
        </div>
      `, false);
    }
  }
}

// Show AI-modified preview
function showAIModifiedPreview(draft, changes, instruction) {
  const changesHtml = changes.map(c => `<li>${c}</li>`).join('');
  
  // Show truncated body preview
  const bodyPreview = (draft.fields.Body || '').substring(0, 300) + ((draft.fields.Body || '').length > 300 ? '...' : '');
  
  addMessage(`
    <div style="background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid #10b981; border-radius: 12px; padding: 16px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <span style="font-size: 24px;">🤖✅</span>
        <span style="font-weight: 600; color: #047857; font-size: 16px;">AI Modified Your Email!</span>
      </div>
      
      <div style="background: #ecfdf5; border: 1px solid #86efac; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 12px; color: #065f46; margin-bottom: 6px;">
          <strong>Your instruction:</strong> "${instruction}"
        </div>
        <div style="font-size: 12px; color: #047857;">
          <strong>Changes applied:</strong>
          <ul style="margin: 4px 0 0 0; padding-left: 16px;">${changesHtml}</ul>
        </div>
      </div>
      
      <div style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
        <div style="margin-bottom: 8px; padding: 8px; background: #f1f5f9; border-radius: 6px; border-left: 3px solid #3b82f6;">
          <strong style="color: #334155;">Subject:</strong> <span style="color: #64748b;">${draft.fields.Subject || 'N/A'}</span>
        </div>
        <div style="padding: 8px; background: #f1f5f9; border-radius: 6px; border-left: 3px solid #10b981; max-height: 200px; overflow-y: auto;">
          <strong style="color: #334155;">Body Preview:</strong>
          <div style="color: #64748b; margin-top: 4px; white-space: pre-wrap; font-size: 12px;">${bodyPreview}</div>
        </div>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px; font-size: 13px; color: #166534;">
        <strong>Next steps:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 16px;">
          <li>Say <span style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">"proceed"</span> to open Gmail</li>
          <li>Request more changes (e.g., "make it shorter", "add mention of quality certifications")</li>
          <li>Say <span style="background: #fef3c7; padding: 2px 6px; border-radius: 4px;">"cancel"</span> to discard</li>
        </ul>
      </div>
    </div>
  `, false);
}

// ============= PREVIEW-ENABLED ACTION FUNCTIONS =============

// PDF Preview
window.generateBidPdf = function(tenderId) {
  const draftId = `pdf-${Date.now()}`;
  const companyDetails = window.currentAnalysis?.companyDetails || {
    name: 'Cable Solutions Pvt Ltd',
    contact_person: 'Sales Manager',
    email: 'sales@cablesolutions.com',
    phone: '+91 22 1234 5678',
    address: 'Mumbai, Maharashtra'
  };
  
  // Include quotation from current analysis if available
  const quotation = window.currentAnalysis?.quotation || null;
  
  const previewData = {
    type: 'pdf',
    tenderId: tenderId,
    companyDetails: companyDetails,
    quotation: quotation, // Store quotation for PDF generation
    fields: {
      'Tender Reference': tenderId,
      'Company': companyDetails.name,
      'Contact Person': companyDetails.contact_person,
      'Email': companyDetails.email,
      'Sections': 'Cover Page, Quotation, Specifications, Testing, Terms'
    }
  };
  
  showPreviewBox('pdf', draftId, previewData, [
    'change contact person to [Name]',
    'change company name to [Company]',
    'proceed - to generate and download'
  ]);
};

// Cover Letter Preview
window.generateCoverLetter = function(tenderId) {
  const draftId = `letter-${Date.now()}`;
  const companyDetails = window.currentAnalysis?.companyDetails || {
    name: 'Cable Solutions Pvt Ltd',
    contact_person: 'Sales Manager',
    designation: 'Managing Director'
  };
  
  const previewData = {
    type: 'letter',
    tenderId: tenderId,
    companyDetails: companyDetails,
    fields: {
      'Tender Reference': tenderId,
      'From Company': companyDetails.name,
      'Contact Person': companyDetails.contact_person,
      'Designation': companyDetails.designation || 'Authorized Signatory',
      'Letter Type': 'Formal Bid Cover Letter'
    }
  };
  
  showPreviewBox('letter', draftId, previewData, [
    'change contact person to [Name]',
    'change company name to [Company]',
    'proceed - to generate and download'
  ]);
};

window.openGmailCompose2 = function(to, subject, body) {
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
  window.open(url, '_blank');
};

// Email Preview (for submission)
window.openStoredGmailCompose = function(rfpId) {
  const emailData = window.pendingEmailData?.[rfpId];
  if (!emailData) {
    addMessage('❌ Email data not found. Please try analyzing the RFP again.');
    return;
  }
  
  const draftId = `email-${Date.now()}`;
  const previewData = {
    type: 'email',
    tenderId: rfpId,
    fields: {
      'To': emailData.to,
      'Subject': emailData.subject,
      'Body': emailData.body
    }
  };
  
  showPreviewBox('email', draftId, previewData, [
    'change subject to [New Subject]',
    'change recipient to [email@example.com]',
    'change contact person to [Name]',
    'proceed - to open Gmail'
  ]);
};

// Testing Email Preview
window.openTestingEmail = function(tenderId) {
  addLoadingMessage('Preparing testing quote request...');
  
  fetch('/api/rfp-proceed/testing-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenderId })
  })
  .then(res => res.json())
  .then(data => {
    removeLastMessage();
    if (data.success) {
      const { to, subject, body } = data.email;
      const draftId = `testing-${Date.now()}`;
      
      const previewData = {
        type: 'testing',
        tenderId: tenderId,
        fields: {
          'To': to,
          'Subject': subject,
          'Body': body
        }
      };
      
      showPreviewBox('testing', draftId, previewData, [
        'change subject to [New Subject]',
        'change recipient to [lab@example.com]',
        'add to body: [Additional text]',
        'proceed - to open Gmail'
      ]);
    } else {
      addMessage(`❌ Error: ${data.error || 'Could not prepare testing email'}`, false);
    }
  });
};

// Calendar Preview
window.openCalendarReminder = function(tenderId, type, dueDate) {
  let title, date, description;
  
  if (type === 'deadline') {
    title = `RFP Submission Deadline: ${tenderId}`;
    date = dueDate || window.currentAnalysis?.dueDate;
    description = `IMPORTANT: Tender ${tenderId} submission deadline.\n\nEnsure all documents are:\n- Bid PDF generated and signed\n- Required certificates attached\n- Testing reports ready (if applicable)\n- Submission via required method completed`;
  } else if (type === 'registration') {
    title = `Portal Registration Opens: ${tenderId}`;
    const regInfo = window.currentAnalysis?.submissionPackage?.calendarReminders?.registrationStart;
    date = regInfo?.date;
    description = regInfo?.description || `Registration window opens for tender ${tenderId}. Register early to participate in the bidding process.`;
  }
  
  if (!date) {
    addMessage(`⚠️ Unable to set reminder - date not available for ${tenderId}`, false);
    return;
  }
  
  const draftId = `calendar-${Date.now()}`;
  const previewData = {
    type: 'calendar',
    tenderId: tenderId,
    reminderDays: 1,
    fields: {
      'Title': title,
      'Date': date,
      'Reminder': '1 day before',
      'Notes': description.substring(0, 200) + '...'
    }
  };
  
  showPreviewBox('calendar', draftId, previewData, [
    'change title to [New Title]',
    'change date to [YYYY-MM-DD]',
    'proceed - to add to Google Calendar'
  ]);
};

window.generateSubmissionPackage = function(tenderId) {
  window.proceedWithRFP(tenderId);
};

// Open orchestration page for search results - shows full agent workflow
window.openSearchWorkflow = function() {
  const params = new URLSearchParams({
    query: lastSearchQuery || 'Search Query',
    mode: 'search',
    results: lastSearchResults?.totalTenders || 0,
    portals: lastSearchResults?.portals?.length || 3,
    totalValue: lastSearchResults?.totalValue || 0
  });
  window.open(`/agent-orchestration.html?${params.toString()}`, 'agentOrchestration', 'width=1600,height=1000');
};

// Open orchestration page for RFP analysis - shows Technical & Pricing agents active
window.openAnalyzeWorkflow = function(tenderId, totalValue) {
  const params = new URLSearchParams({
    query: `Analyzing RFP ${tenderId}`,
    mode: 'rfp',  // RFP mode - Technical & Pricing active, Sales completed
    tenderId: tenderId || '',
    totalValue: totalValue || 0
  });
  window.open(`/agent-orchestration.html?${params.toString()}`, 'agentOrchestration', 'width=1600,height=1000');
};

// Legacy function for backward compatibility
window.openWorkflowPage = function() {
  window.openSearchWorkflow();
};

// Detect portal from query string
function detectPortalFromQuery(q) {
  const lowerQuery = q.toLowerCase();
  if (lowerQuery.includes('gov') || lowerQuery.includes('government')) return 'gov';
  if (lowerQuery.includes('industrial') || lowerQuery.includes('industry')) return 'industrial';
  if (lowerQuery.includes('util') || lowerQuery.includes('utilities')) return 'utilities';
  return null;
}

// Open orchestration from search results
window.viewOrchestration = function(query) {
  const portal = detectPortalFromQuery(query || lastSearchQuery || '');
  const params = new URLSearchParams({
    query: query || lastSearchQuery || 'Cable Search',
    mode: 'search',
    results: lastSearchResults?.totalTenders || 0
  });
  if (portal) params.set('portal', portal);
  window.open(`/agent-orchestration.html?${params.toString()}`, 'agentOrchestration', 'width=1600,height=1000');
};

function formatRankedResults(rankedData) {
  const { ranked_tenders, dataset_usage } = rankedData;
  
  let html = '<div class="ranked-results">';
  html += '<h3 style="margin-bottom: 15px;">🏆 Ranked Tenders with SKU Matching & Counter Offers</h3>';
  
  // Show dataset usage info if available
  if (dataset_usage) {
    html += `
      <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 12px; border-radius: 8px; margin-bottom: 15px; color: white; font-size: 13px;">
        <strong>📂 Datasets Used:</strong> ${dataset_usage.products_searched} SKUs searched • ${dataset_usage.skus_matched?.length || 0} matched • Pricing rules applied
      </div>
    `;
  }
  
  ranked_tenders.forEach((item, index) => {
    const rankClass = index < 3 ? 'rank-top' : '';
    const scoreColor = item.rank_score >= 80 ? '#48bb78' : item.rank_score >= 60 ? '#4299e1' : '#ed8936';
    
    // SKU Match section
    let skuMatchHtml = '';
    if (item.sku_match && item.sku_match.top_sku) {
      const specMatchColor = item.sku_match.spec_match_percentage >= 80 ? '#48bb78' : item.sku_match.spec_match_percentage >= 60 ? '#4299e1' : '#ed8936';
      skuMatchHtml = `
        <div class="sku-match-box" style="background: linear-gradient(135deg, #f59e0b22 0%, #d9770622 100%); border: 1px solid #f59e0b44; padding: 12px; border-radius: 8px; margin: 10px 0;">
          <div style="font-weight: 600; color: #f59e0b; margin-bottom: 8px;">🔧 SKU Match (from products.csv)</div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600;">${item.sku_match.top_sku}</div>
              <div style="font-size: 12px; color: #8892a6;">${item.sku_match.top_sku_name || 'Matched Product'}</div>
            </div>
            <div style="background: ${specMatchColor}; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 600;">
              ${item.sku_match.spec_match_percentage}% Match
            </div>
          </div>
          ${item.sku_match.top_3_skus && item.sku_match.top_3_skus.length > 1 ? `
            <div style="margin-top: 8px; font-size: 11px; color: #8892a6;">
              <strong>Alternatives:</strong> 
              ${item.sku_match.top_3_skus.slice(1).map(s => `${s.sku_id} (${s.spec_match}%)`).join(', ')}
            </div>
          ` : ''}
        </div>
      `;
    }
    
    // Tests section - SCALED based on project value (2-5% of RFP)
    let testsHtml = '';
    if (item.applicable_tests && item.applicable_tests.length > 0) {
      const testPercentage = item.test_cost_percentage?.toFixed(1) || '3.0';
      testsHtml = `
        <div style="background: #1e2d4a; padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px;">
          <strong style="color: #ec4899;">🧪 Required Tests (scaled to project value):</strong>
          <div style="margin-top: 6px; color: #8892a6;">
            ${item.applicable_tests.slice(0, 3).map(t => `${t.test_id}: ${t.test_name} (₹${t.price_inr?.toLocaleString('en-IN')})`).join(' • ')}
          </div>
          <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #ec4899; font-weight: 600;">Total Test Cost: ₹${item.total_test_cost?.toLocaleString('en-IN') || '0'}</span>
            <span style="color: #8892a6; font-size: 11px;">(${testPercentage}% of project value)</span>
          </div>
        </div>
      `;
    }
    
    html += `
      <div class="ranked-item ${rankClass}">
        <div class="rank-header">
          <span class="rank-number">#${index + 1}</span>
          <span class="rank-score" style="background: ${scoreColor}">Score: ${item.rank_score}/100</span>
          <span class="company-rating">Rating: ${item.company_rating || item.company_credibility_label}</span>
        </div>
        <div class="rank-title">
          <a href="${item.portal_url || '#'}" style="text-decoration: none; color: inherit;">
            ${item.tender_id} - ${item.title}
          </a>
          ${item.portal_name ? `<a href="${item.portal_url}" class="portal-tag-link" style="margin-left: 8px;"><span class="portal-tag">${item.portal_name}</span></a>` : ''}
        </div>
        <div class="rank-meta">
          <a href="${item.company_url}" class="company-link" target="_blank">
            ${item.organisation} (Credibility: ${item.company_credibility}%)
          </a>
        </div>
        ${skuMatchHtml}
        <div class="price-analysis">
          <div class="price-row">
            <span>Tender Price:</span> <strong>₹${item.tender_cost.toLocaleString('en-IN')}</strong>
          </div>
          <div class="price-row">
            <span>Market Rate:</span> <strong>₹${item.market_rate.toLocaleString('en-IN')}</strong>
          </div>
          <div class="price-row">
            <span>Variance:</span> <strong>${item.price_analysis.variance}</strong>
          </div>
        </div>
        ${testsHtml}
        <div class="counter-offer-box">
          <div class="co-header">💰 Recommended Counter Offer</div>
          <div class="co-price">₹${item.counter_offer.suggestedPrice.toLocaleString('en-IN')}</div>
          <div class="co-discount">(${item.counter_offer.discount}% discount)</div>
          <button class="email-btn" onclick="openGmailCompose(${JSON.stringify(item.counter_offer).replace(/"/g, '&quot;')})">
            ✉️ Open Gmail Compose
          </button>
          <button class="email-btn" onclick="showEmail('${item.tender_id}', ${JSON.stringify(item.counter_offer).replace(/"/g, '&quot;')})" style="margin-top: 8px; background: #6c757d;">
            📋 View Email Template
          </button>
        </div>
        ${item.red_flags && item.red_flags.length > 0 ? `
          <div class="flags-mini">
            <strong>⚠️ Risks:</strong> ${item.red_flags.join(', ')}
          </div>
        ` : ''}
        <div class="proceed-actions" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #334155; display: flex; gap: 10px; flex-wrap: wrap;">
          <button onclick="proceedWithRFP('${item.tender_id}', '${item.title?.replace(/'/g, "\\'")}')" 
            style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; padding: 10px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; flex: 1;">
            🚀 Proceed with this RFP
          </button>
          <button onclick="viewRFPDetails('${item.tender_id}')" 
            style="background: #475569; color: white; border: none; padding: 10px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">
            📋 Details
          </button>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

window.analyzeTenders = async function(tenders) {
  addLoadingMessage('Analyzing tenders...');
  
  try {
    // Run the regular analysis first (main functionality)
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenders })
    });
    
    const data = await response.json();
    removeLastMessage();
    
    if (data.error) {
      addMessage(`❌ Analysis error: ${data.error}`);
      return;
    }
    
    // Calculate total value for workflow
    const totalValue = tenders.reduce((sum, t) => sum + (t.estimated_cost_inr || 0), 0);
    
    addMessage(`✅ Analyzed and ranked ${data.total} tenders based on credibility, price competitiveness, and track record.`);
    
    // Add button to view workflow (not auto-link)
    addMessage(`<div style="margin: 10px 0; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; text-align: center;">
      <button onclick="openAnalyzeWorkflow(${data.total}, ${totalValue})" style="background: transparent; border: none; color: white; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; font-size: 15px;">
        📊 View Analysis Workflow (Technical + Pricing Agents) →
      </button>
    </div>`);
    
    const rankedHtml = formatRankedResults(data);
    addMessage(rankedHtml);
    
  } catch (error) {
    removeLastMessage();
    addMessage(`❌ Analysis failed. Please try again.`);
    console.error('Analysis error:', error);
  }
};

window.openGmailCompose = function(counterOffer) {
  // Show preview instead of directly opening Gmail
  const draftId = `counter-offer-${Date.now()}`;
  const previewData = {
    type: 'email',
    tenderId: counterOffer.tenderId || 'counter-offer',
    fields: {
      'To': counterOffer.contactEmail,
      'Subject': counterOffer.emailSubject,
      'Body': counterOffer.emailBody
    }
  };
  
  showPreviewBox('email', draftId, previewData, [
    'change subject to [New Subject]',
    'change recipient to [email@example.com]',
    'add to body: [Additional negotiation points]',
    'proceed - to open Gmail'
  ]);
};

window.showEmail = function(tenderId, counterOffer) {
  const mailtoUrl = `mailto:${counterOffer.contactEmail}?subject=${encodeURIComponent(counterOffer.emailSubject)}&body=${encodeURIComponent(counterOffer.emailBody)}`;
  
  const emailHtml = `
    <div class="email-template">
      <div class="email-header">📧 Counter Offer Email for ${tenderId}</div>
      <div class="email-field">
        <strong>To:</strong> ${counterOffer.contactEmail}
      </div>
      <div class="email-field">
        <strong>Subject:</strong> ${counterOffer.emailSubject}
      </div>
      <div class="email-body">
        <strong>Message:</strong><br>
        <textarea readonly style="width: 100%; min-height: 200px; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: inherit; font-size: 14px;">
${counterOffer.emailBody}</textarea>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button onclick="copyEmail('${counterOffer.emailBody.replace(/'/g, '\\\'')}')" class="copy-btn">
          📋 Copy Email
        </button>
        <a href="${mailtoUrl}" class="copy-btn" style="text-decoration: none; display: inline-block; padding: 10px 20px;">
          📧 Open with Mail Client
        </a>
      </div>
    </div>
  `;
  addMessage(emailHtml);
};

window.copyEmail = function(emailBody) {
  navigator.clipboard.writeText(emailBody).then(() => {
    addMessage('✅ Email copied to clipboard!');
  });
};

// File upload handling with attachment preview
const fileUpload = document.getElementById('file-upload');
let pendingFile = null; // Store file until user sends message

// Show/hide attachment preview
function showAttachmentPreview(file) {
  removeAttachmentPreview(); // Remove any existing preview
  
  const previewDiv = document.createElement('div');
  previewDiv.id = 'attachment-preview';
  previewDiv.style.cssText = `
    background: linear-gradient(135deg, #1e3a5f, #2d5a87);
    color: white;
    padding: 10px 15px;
    border-radius: 8px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  `;
  
  const isCSV = file.name.endsWith('.csv');
  const icon = isCSV ? '📊' : '📄';
  const typeLabel = isCSV ? 'CSV Data' : 'Document';
  
  previewDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 24px;">${icon}</span>
      <div>
        <div style="font-weight: 600;">${file.name}</div>
        <div style="font-size: 11px; opacity: 0.8;">${typeLabel} • ${(file.size / 1024).toFixed(1)} KB</div>
      </div>
    </div>
    <button id="remove-attachment" style="
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    ">✕</button>
  `;
  
  // Insert before the form
  const chatForm = document.getElementById('chat-form');
  chatForm.parentNode.insertBefore(previewDiv, chatForm);
  
  // Add remove button handler
  document.getElementById('remove-attachment').addEventListener('click', () => {
    removeAttachmentPreview();
    pendingFile = null;
    fileUpload.value = '';
  });
  
  // Update placeholder
  userInput.placeholder = isCSV 
    ? 'Add instruction (e.g., "use these prices for quotations")...'
    : 'Add instruction (e.g., "analyze this RFP")...';
}

function removeAttachmentPreview() {
  const existing = document.getElementById('attachment-preview');
  if (existing) existing.remove();
  userInput.placeholder = "Type your question or upload a document... (e.g., 'find copper cables in Mumbai')";
}

fileUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Validate file type
  const isCSV = file.type === 'text/csv' || file.name.endsWith('.csv');
  const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  
  if (!allowedTypes.includes(file.type) && !isCSV) {
    addMessage('❌ Please upload PDF, Word documents (.pdf, .doc, .docx), or CSV files (.csv)', false);
    fileUpload.value = '';
    return;
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    addMessage('❌ File size must be less than 10MB', false);
    fileUpload.value = '';
    return;
  }

  // Store file and show preview - DON'T process immediately
  pendingFile = file;
  showAttachmentPreview(file);
  
  // Focus input for user to type additional instructions
  userInput.focus();
});

// Process file when user sends (either with Enter or clicking send)
async function processFileWithMessage(file, userMessage) {
  // Check if it's a CSV file for adaptive data
  if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
    if (userMessage) {
      addMessage(userMessage, true);
    }
    addMessage(`📊 Uploading CSV: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)`, true);
    await handleCSVUpload(file, userMessage);
    return;
  }

  // For documents (PDF/Word)
  addMessage(`📄 Uploading document: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)${userMessage ? `<br><em>${userMessage}</em>` : ''}`, true);
  addLoadingMessage('Scanning document with AI...');

  try {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('sessionId', sessionId);

    const response = await fetch('/api/upload/document', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    
    removeLastMessage();

    if (!data.success) {
      addMessage(`❌ Document analysis failed: ${data.error || 'Unknown error'}`);
      fileUpload.value = '';
      return;
    }

    // Format extracted data
    let resultHtml = `<h2>📄 Document Analysis: ${data.fileName}</h2>`;
    
    if (data.extractedData) {
      resultHtml += '<h3>Extracted Information:</h3>';
      resultHtml += '<ul>';
      if (data.extractedData.tender_id) resultHtml += `<li><strong>Tender ID:</strong> ${data.extractedData.tender_id}</li>`;
      if (data.extractedData.organisation) resultHtml += `<li><strong>Organisation:</strong> ${data.extractedData.organisation}</li>`;
      if (data.extractedData.title) resultHtml += `<li><strong>Title:</strong> ${data.extractedData.title}</li>`;
      if (data.extractedData.material) resultHtml += `<li><strong>Material:</strong> ${data.extractedData.material}</li>`;
      if (data.extractedData.estimated_cost_inr) resultHtml += `<li><strong>Estimated Cost:</strong> ₹${parseInt(data.extractedData.estimated_cost_inr).toLocaleString('en-IN')}</li>`;
      if (data.extractedData.due_date) resultHtml += `<li><strong>Due Date:</strong> ${data.extractedData.due_date}</li>`;
      if (data.extractedData.city) resultHtml += `<li><strong>Location:</strong> ${data.extractedData.city}</li>`;
      resultHtml += '</ul>';
    }

    if (data.companyInfo) {
      resultHtml += '<h3>🏢 Company Credibility (OpenCorporates):</h3>';
      resultHtml += '<div class="company-credibility-box" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; border-radius: 8px; margin: 10px 0;">';
      
      const scoreColor = data.companyInfo.raw_score >= 75 ? '#48bb78' : data.companyInfo.raw_score >= 50 ? '#4299e1' : '#ed8936';
      resultHtml += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">`;
      resultHtml += `<div><strong>${data.companyInfo.name}</strong></div>`;
      resultHtml += `<div style="background: ${scoreColor}; padding: 5px 12px; border-radius: 20px; font-weight: bold;">${data.companyInfo.raw_score}/100</div>`;
      resultHtml += `</div>`;
      
      resultHtml += `<div style="font-size: 13px; opacity: 0.95;">`;
      resultHtml += `<div style="margin: 5px 0;">📊 <strong>Credibility:</strong> ${data.companyInfo.credibility_label}</div>`;
      resultHtml += `<div style="margin: 5px 0;">✅ <strong>Status:</strong> ${data.companyInfo.status}</div>`;
      resultHtml += `<div style="margin: 5px 0;">📅 <strong>Age:</strong> ${data.companyInfo.age_years} years</div>`;
      resultHtml += `<div style="margin: 5px 0;">🌍 <strong>Jurisdiction:</strong> ${data.companyInfo.jurisdiction}</div>`;
      resultHtml += `<div style="margin: 5px 0;">🏛️ <strong>Type:</strong> ${data.companyInfo.company_type}</div>`;
      
      if (data.companyInfo.oc_url) {
        resultHtml += `<div style="margin: 10px 0;"><a href="${data.companyInfo.oc_url}" target="_blank" style="color: white; text-decoration: underline;">🔗 View on OpenCorporates</a></div>`;
      }
      
      if (data.companyInfo.red_flags && data.companyInfo.red_flags.length > 0) {
        resultHtml += `<div style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px;">`;
        resultHtml += `<strong>⚠️ Risk Factors:</strong>`;
        data.companyInfo.red_flags.forEach(flag => {
          resultHtml += `<div style="margin: 3px 0;">• ${flag}</div>`;
        });
        resultHtml += `</div>`;
      }
      
      if (data.companyInfo.green_flags && data.companyInfo.green_flags.length > 0) {
        resultHtml += `<div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.15); border-radius: 5px;">`;
        resultHtml += `<strong>✅ Strengths:</strong>`;
        data.companyInfo.green_flags.forEach(flag => {
          resultHtml += `<div style="margin: 3px 0;">• ${flag}</div>`;
        });
        resultHtml += `</div>`;
      }
      
      resultHtml += `</div></div>`;
    }

    if (data.analysis) {
      resultHtml += '<h3>AI Analysis:</h3>';
      resultHtml += `<div style="white-space: pre-wrap;">${data.analysis}</div>`;
    }

    // Add Submission Details Section
    if (data.extractedData && data.extractedData.submission) {
      const submission = data.extractedData.submission;
      resultHtml += renderSubmissionSection(submission, data.extractedData);
    }

    // Add "Proceed with RFP" button
    if (data.extractedData && data.extractedData.tender_id) {
      const rfpId = data.extractedData.tender_id;
      resultHtml += `
        <div class="rfp-actions" style="margin-top: 20px; padding: 15px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px;">
          <h4 style="color: white; margin-bottom: 10px;">🚀 Ready to Proceed?</h4>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button onclick="proceedWithRFP('${rfpId}', '${data.fileName || ''}')" 
              style="background: white; color: #059669; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">
              ✅ Proceed with this RFP
            </button>
            <button onclick="downloadRFPDocument('${rfpId}')" 
              style="background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">
              📥 Download RFP Document
            </button>
          </div>
        </div>
      `;
      
      // Store RFP data for later use
      window.lastUploadedRFP = data.extractedData;
    }

    addMessage(resultHtml);
    
  } catch (error) {
    removeLastMessage();
    addMessage(`❌ Failed to analyze document. Please try again.`);
    console.error('Upload error:', error);
  }

  // Clear file input
  fileUpload.value = '';
}

// Render submission instructions section
function renderSubmissionSection(submission, rfpData) {
  const mode = submission.mode || 'PDF_FORM_FILL';
  const modeLabels = {
    'PDF_FORM_FILL': '📄 Internal Form Fill & Email',
    'EMAIL_FORM': '📧 Email Form Submission',
    'LETTER_COURIER': '📮 Physical Letter/Courier',
    'EXTERNAL_PORTAL': '🌐 External Portal Registration',
    'MEETING_EMAIL': '📅 Pre-bid Meeting Request'
  };
  
  let html = `
    <div class="submission-section" style="margin-top: 20px; background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #1976d2;">
      <h3 style="color: #1565c0; margin-bottom: 15px;">📋 Submission Requirements</h3>
      <div style="background: white; padding: 15px; border-radius: 6px; margin-bottom: 15px;">
        <div style="font-size: 16px; font-weight: 600; color: #1976d2; margin-bottom: 10px;">
          ${modeLabels[mode] || mode}
        </div>
        <p style="color: #666; margin-bottom: 10px;">${submission.submission_notes || 'Follow the submission instructions carefully.'}</p>
  `;
  
  // Mode-specific details
  switch (mode) {
    case 'PDF_FORM_FILL':
      html += `
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">
          <div><strong>📧 Send to:</strong> ${submission.submission_email || submission.email_to || 'N/A'}</div>
          ${submission.form_annexure ? `<div><strong>📄 Form:</strong> ${submission.form_annexure} (Pre-filled in bid document)</div>` : ''}
          ${submission.email_subject_template ? `<div><strong>📝 Subject:</strong> ${submission.email_subject_template}</div>` : ''}
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #e8f5e9; border-radius: 4px; color: #2e7d32;">
          ✅ <strong>Steps:</strong> 1) Generate Bid PDF → 2) Print & Sign page 2 → 3) Scan signed form → 4) Email with attachments
        </div>
      `;
      break;
      
    case 'EMAIL_FORM':
      html += `
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">
          <div><strong>📧 Send to:</strong> ${submission.submission_email || submission.email_to || 'N/A'}</div>
          ${submission.form_annexure ? `<div><strong>📄 Form:</strong> ${submission.form_annexure}</div>` : ''}
          ${submission.email_subject_template ? `<div><strong>📝 Subject:</strong> ${submission.email_subject_template}</div>` : ''}
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #fff3e0; border-radius: 4px; color: #e65100;">
          ⚠️ <strong>Action Required:</strong> Fill the bid response form and attach required documents before emailing.
        </div>
      `;
      break;
      
    case 'LETTER_COURIER':
      html += `
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">
          <div><strong>📮 Courier to:</strong></div>
          <div style="white-space: pre-line; margin-top: 5px;">${submission.submission_address || submission.postal_address || 'Address not specified'}</div>
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #ffebee; border-radius: 4px; color: #c62828;">
          ⚠️ <strong>IMPORTANT:</strong> This submission requires PRINTED documents to be physically couriered. Digital submission NOT accepted.
        </div>
      `;
      break;
      
    case 'EXTERNAL_PORTAL':
      html += `
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">
          <div><strong>🌐 Registration Portal:</strong></div>
          <a href="${submission.vendor_portal_url || submission.portal_url || '#'}" target="_blank" style="color: #1976d2;">${submission.vendor_portal_url || submission.portal_url || 'Portal URL not available'}</a>
          ${submission.tender_portal_url ? `<div style="margin-top: 5px;"><strong>📋 Tender Link:</strong> <a href="${submission.tender_portal_url}" target="_blank" style="color: #1976d2;">${submission.tender_portal_url}</a></div>` : ''}
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #e8f5e9; border-radius: 4px; color: #2e7d32;">
          ✅ <strong>Steps:</strong> 1) Register on portal → 2) Complete KYC → 3) Find tender → 4) Upload documents → 5) Submit bid
        </div>
      `;
      break;
      
    case 'MEETING_EMAIL':
      html += `
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">
          <div><strong>📧 Meeting Request Email:</strong> ${submission.meeting_email || 'N/A'}</div>
          ${submission.meeting_subject_template ? `<div><strong>📝 Subject:</strong> ${submission.meeting_subject_template}</div>` : ''}
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #fff8e1; border-radius: 4px; color: #f57f17;">
          📅 <strong>Note:</strong> A pre-bid meeting is required BEFORE formal submission. Request a slot early!
        </div>
      `;
      break;
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

// Proceed with RFP - Generate submission documents
async function proceedWithRFP(rfpId, fileName) {
  addMessage(`🚀 <strong>Proceeding with RFP: ${rfpId}</strong>`, true);
  addLoadingMessage('Generating submission documents...');
  
  try {
    // Get the stored RFP data
    const rfpData = window.lastUploadedRFP || {};
    
    const response = await fetch('/api/pdf/generate-submission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfp_id: rfpId,
        rfp_data: rfpData,
        bidder_info: {
          name: 'Opal Cables Pvt. Ltd.',
          address: '123 Industrial Area, Phase II, Mumbai - 400001',
          gst: '27AABCO1234A1Z5',
          pan: 'AABCO1234A',
          contact_person: 'Mr. Procurement Manager',
          email: 'procurement@opalcables.com',
          phone: '+91-22-12345678'
        }
      })
    });
    
    const data = await response.json();
    removeLastMessage();
    
    if (!data.success) {
      addMessage(`❌ Failed to generate submission: ${data.error}`);
      return;
    }
    
    // Display submission results
    let html = `<div class="submission-result" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px;">`;
    html += `<h2 style="margin-bottom: 15px;">📋 Submission Package Ready</h2>`;
    html += `<p><strong>RFP:</strong> ${rfpId}</p>`;
    html += `<p><strong>Submission Mode:</strong> ${data.submission_plan?.submission_mode?.replace(/_/g, ' ') || 'N/A'}</p>`;
    
    // Action steps
    if (data.submission_plan?.actions) {
      html += `<div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin: 15px 0;">`;
      html += `<h4 style="margin-bottom: 10px;">📝 Action Steps:</h4>`;
      data.submission_plan.actions.forEach((action, i) => {
        const statusIcon = action.status === 'AUTO_GENERATED' || action.status === 'DRAFT_READY' || action.status === 'LETTER_READY' || action.status === 'EMAIL_READY' ? '✅' : '⏳';
        html += `<div style="margin: 8px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
          ${statusIcon} <strong>Step ${action.step}:</strong> ${action.description}
          <span style="opacity: 0.7; font-size: 12px;"> (${action.status})</span>
        </div>`;
      });
      html += `</div>`;
    }
    
    // Generated artifacts
    html += `<div style="margin-top: 15px;">`;
    html += `<h4 style="margin-bottom: 10px;">📦 Generated Documents:</h4>`;
    
    const mode = data.submission_plan?.submission_mode;
    
    if (mode === 'EMAIL_FORM' && data.submission_plan?.artefacts?.email_draft) {
      const emailDraft = data.submission_plan.artefacts.email_draft;
      html += `
        <div style="background: white; color: #333; padding: 15px; border-radius: 8px; margin: 10px 0;">
          <h5 style="color: #1976d2;">📧 Email Draft</h5>
          <p><strong>To:</strong> ${emailDraft.to || data.submission_plan.artefacts.email_to}</p>
          <p><strong>Subject:</strong> ${emailDraft.subject || data.submission_plan.artefacts.email_subject}</p>
          <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${emailDraft.body}</div>
        </div>
      `;
      
      // Gmail compose button
      if (data.submission_plan.gmail_compose_url) {
        html += `<a href="${data.submission_plan.gmail_compose_url}" target="_blank" 
          style="display: inline-block; background: #ea4335; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 10px 0;">
          📧 Open in Gmail
        </a>`;
      }
      
      // Form data
      if (data.submission_plan.artefacts.form_data) {
        html += `
          <button onclick="downloadFormData('${rfpId}')" 
            style="background: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 10px 5px;">
            📥 Download Bid Form (JSON)
          </button>
        `;
      }
    }
    
    if (mode === 'LETTER_COURIER' && data.submission_plan?.artefacts?.letter_content) {
      const letter = data.submission_plan.artefacts.letter_content;
      html += `
        <div style="background: white; color: #333; padding: 15px; border-radius: 8px; margin: 10px 0;">
          <h5 style="color: #c62828;">📮 Formal Letter (MUST BE PRINTED)</h5>
          <p><strong>Date:</strong> ${letter.date}</p>
          <p><strong>Reference:</strong> ${letter.reference}</p>
          <p><strong>To:</strong> ${letter.to?.designation}, ${letter.to?.organization}</p>
          <div style="background: #ffebee; padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 13px; white-space: pre-wrap; max-height: 300px; overflow-y: auto;">${letter.body}</div>
        </div>
        <div style="background: #c62828; padding: 15px; border-radius: 8px; margin: 10px 0;">
          ⚠️ <strong>COURIER ADDRESS:</strong><br>
          ${data.submission_plan.artefacts.postal_address}
        </div>
        <button onclick="generateLetterPDF('${rfpId}')" 
          style="background: #c62828; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 10px 5px;">
          🖨️ Generate Printable Letter PDF
        </button>
      `;
    }
    
    if (mode === 'EXTERNAL_PORTAL') {
      const portal = data.submission_plan.artefacts;
      html += `
        <div style="background: white; color: #333; padding: 15px; border-radius: 8px; margin: 10px 0;">
          <h5 style="color: #1565c0;">🌐 Portal Registration Checklist</h5>
          <ol style="margin: 10px 0; padding-left: 20px;">
            <li>Visit the registration portal</li>
            <li>Create vendor account with company details</li>
            <li>Complete KYC verification (upload PAN, GST, Bank details)</li>
            <li>Navigate to "Open Tenders"</li>
            <li>Find and select this tender</li>
            <li>Upload technical and commercial documents</li>
            <li>Submit before deadline</li>
          </ol>
        </div>
        <a href="${portal.portal_url}" target="_blank" 
          style="display: inline-block; background: #1565c0; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 10px 0;">
          🌐 Go to Portal Registration
        </a>
      `;
      
      // Registration data download
      if (portal.registration_data) {
        html += `
          <button onclick="downloadRegistrationData('${rfpId}')" 
            style="background: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 10px 5px;">
            📥 Download Registration Data
          </button>
        `;
      }
    }
    
    if (mode === 'MEETING_EMAIL' && data.submission_plan?.artefacts?.email_draft) {
      const emailDraft = data.submission_plan.artefacts.email_draft;
      html += `
        <div style="background: white; color: #333; padding: 15px; border-radius: 8px; margin: 10px 0;">
          <h5 style="color: #f57f17;">📅 Meeting Request Email</h5>
          <p><strong>To:</strong> ${emailDraft.to || data.submission_plan.artefacts.meeting_email}</p>
          <p><strong>Subject:</strong> ${emailDraft.subject || data.submission_plan.artefacts.email_subject}</p>
          <div style="background: #fff8e1; padding: 10px; border-radius: 4px; margin-top: 10px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${emailDraft.body}</div>
        </div>
      `;
      
      if (data.submission_plan.gmail_compose_url) {
        html += `<a href="${data.submission_plan.gmail_compose_url}" target="_blank" 
          style="display: inline-block; background: #f57f17; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 10px 0;">
          📧 Send Meeting Request via Gmail
        </a>`;
      }
    }
    
    html += `</div></div>`;
    
    // Store submission plan for downloads
    window.lastSubmissionPlan = data.submission_plan;
    
    addMessage(html);
    
  } catch (error) {
    removeLastMessage();
    addMessage(`❌ Failed to generate submission: ${error.message}`);
    console.error('Submission generation error:', error);
  }
}

// Download RFP Document
function downloadRFPDocument(rfpId) {
  const pdfUrl = `/rfps/${rfpId}.pdf`;
  const link = document.createElement('a');
  link.href = pdfUrl;
  link.download = `${rfpId}.pdf`;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Legacy function for backward compatibility
function viewRFPDetails(rfpId) {
  downloadRFPDocument(rfpId);
}

// Download form data as JSON
function downloadFormData(rfpId) {
  const plan = window.lastSubmissionPlan;
  if (!plan?.artefacts?.form_data) {
    alert('Form data not available');
    return;
  }
  const blob = new Blob([JSON.stringify(plan.artefacts.form_data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bid-form-${rfpId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Download registration data
function downloadRegistrationData(rfpId) {
  const plan = window.lastSubmissionPlan;
  if (!plan?.artefacts?.registration_data) {
    alert('Registration data not available');
    return;
  }
  const blob = new Blob([JSON.stringify(plan.artefacts.registration_data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `registration-data-${rfpId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Generate letter PDF (calls backend) - with preview
window.generateLetterPDF = function(rfpId) {
  const draftId = `printable-letter-${Date.now()}`;
  const companyDetails = window.currentAnalysis?.companyDetails || {
    name: 'Cable Solutions Pvt Ltd',
    contact_person: 'Rajesh Kumar',
    designation: 'Managing Director',
    address: '123 Industrial Area, Phase II\nGurgaon, Haryana 122001, India'
  };
  
  const previewData = {
    type: 'printable-letter',
    tenderId: rfpId,
    companyDetails: companyDetails,
    letterContent: window.lastSubmissionPlan?.artefacts?.letter_content,
    fields: {
      'Tender Reference': rfpId,
      'From Company': companyDetails.name,
      'Contact Person': companyDetails.contact_person,
      'Designation': companyDetails.designation || 'Managing Director',
      'Letter Purpose': 'Physical Courier Submission',
      'Postal Address': window.lastSubmissionPlan?.artefacts?.postal_address || 'As per tender document'
    }
  };
  
  showPreviewBox('letter', draftId, previewData, [
    'change contact person to [Name]',
    'change company name to [Company]',
    'change designation to [Title]',
    'proceed - to generate and download'
  ]);
};

// Execute printable letter generation
async function executePrintableLetterPDF(draft) {
  try {
    addLoadingMessage('Generating PDF...');
    
    const companyDetails = {
      name: draft.fields?.['From Company'] || draft.companyDetails?.name || 'Cable Solutions Pvt Ltd',
      contact_person: draft.fields?.['Contact Person'] || draft.companyDetails?.contact_person || 'Sales Manager',
      designation: draft.fields?.['Designation'] || draft.companyDetails?.designation || 'Managing Director',
      address: draft.companyDetails?.address || '123 Industrial Area, Phase II\nGurgaon, Haryana 122001, India'
    };
    
    const response = await fetch('/api/pdf/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfp_id: draft.tenderId,
        letter_content: draft.letterContent,
        company_details: companyDetails
      })
    });
    
    if (response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bid-letter-${draft.tenderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      removeLastMessage();
      addMessage('✅ Letter PDF downloaded with your modifications! Please print and courier to the specified address.');
    } else {
      removeLastMessage();
      addMessage('❌ Failed to generate PDF. Using JSON download instead.');
      downloadFormData(draft.tenderId);
    }
  } catch (error) {
    removeLastMessage();
    addMessage('❌ Failed to generate PDF: ' + error.message);
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const query = userInput.value.trim();
  
  // ========== HANDLE PENDING FILE WITH MESSAGE ==========
  if (pendingFile) {
    const file = pendingFile;
    pendingFile = null;
    removeAttachmentPreview();
    fileUpload.value = '';
    userInput.value = '';
    
    await processFileWithMessage(file, query);
    return;
  }
  // =====================================================
  
  if (!query) return;
  
  // Store query for workflow viewing
  lastSearchQuery = query;
  
  addMessage(query, true);
  userInput.value = '';
  
  // ========== CHECK FOR DRAFT MODIFICATION COMMANDS FIRST ==========
  if (window.checkDraftCommands && window.checkDraftCommands(query)) {
    return; // Draft command was handled
  }
  // ================================================================
  
  addLoadingMessage('Thinking...');
  
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, sessionId, userLocation })
    });
    
    const data = await response.json();
    
    removeLastMessage();
    
    if (data.error) {
      addMessage(`❌ Sorry, I encountered an error: ${data.error}`);
      return;
    }
    
    if (data.response) {
      addMessage(data.response);
    }
    
    if (data.results) {
      let resultsHtml;
      // Check if this is AI search results with permutation process
      if (data.results.type === 'ai_search' && data.searchProcess) {
        resultsHtml = formatAISearchResults(data.results, data.searchProcess);
      } else {
        resultsHtml = formatTenderResults(data.results);
      }
      addMessage(resultsHtml);
    }
    
  } catch (error) {
    removeLastMessage();
    addMessage(`❌ Sorry, something went wrong. Please try again.`);
    console.error('Chat error:', error);
  }
});

window.openReminderModal = function(tenderId, title, dueDate, organisation) {
  const modal = document.getElementById('reminder-modal');
  document.getElementById('reminder-tender-id').value = tenderId;
  document.getElementById('reminder-title').textContent = `${tenderId} - ${title}`;
  document.getElementById('reminder-org').textContent = organisation;
  document.getElementById('reminder-due-date').textContent = new Date(dueDate).toLocaleDateString('en-IN');
  
  const reminderDate = new Date(dueDate);
  reminderDate.setDate(reminderDate.getDate() - 3);
  document.getElementById('reminder-datetime').value = reminderDate.toISOString().slice(0, 16);
  
  modal.style.display = 'flex';
};

window.closeReminderModal = function() {
  document.getElementById('reminder-modal').style.display = 'none';
};

window.saveReminder = async function() {
  const tenderId = document.getElementById('reminder-tender-id').value;
  const reminderTime = document.getElementById('reminder-datetime').value;
  const notes = document.getElementById('reminder-notes').value;
  
  if (!reminderTime) {
    alert('Please select a reminder date and time');
    return;
  }
  
  try {
    const response = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfpId: tenderId,
        reminderTime,
        notes
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      closeReminderModal();
      addMessage(`✅ Reminder set for ${tenderId} on ${new Date(reminderTime).toLocaleString('en-IN')}`);
    } else {
      alert('Failed to save reminder: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Failed to save reminder');
    console.error('Reminder error:', error);
  }
};

window.addToGoogleCalendar = function() {
  const tenderId = document.getElementById('reminder-tender-id').value;
  const title = document.getElementById('reminder-title').textContent;
  const reminderTime = document.getElementById('reminder-datetime').value;
  const notes = document.getElementById('reminder-notes').value;
  const org = document.getElementById('reminder-org').textContent;
  const dueDate = document.getElementById('reminder-due-date').textContent;
  
  if (!reminderTime) {
    alert('Please select a reminder date and time');
    return;
  }
  
  const startDate = new Date(reminderTime);
  const endDate = new Date(startDate.getTime() + 30 * 60000);
  
  const formatDateForGoogle = (date) => {
    return date.toISOString().replace(/-|:|\.\d+/g, '');
  };
  
  const eventTitle = `Tender Reminder: ${title}`;
  const eventDescription = `Tender: ${title}
Organisation: ${org}
Tender Due Date: ${dueDate}
${notes ? '\nNotes: ' + notes : ''}

Don't forget to submit your proposal!`;
  
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(eventTitle)}` +
    `&dates=${formatDateForGoogle(startDate)}/${formatDateForGoogle(endDate)}` +
    `&details=${encodeURIComponent(eventDescription)}` +
    `&sf=true&output=xml`;
  
  window.open(googleCalendarUrl, '_blank', 'noopener,noreferrer');
  
  closeReminderModal();
  addMessage(`✅ Google Calendar opened! Click "Save" to add the reminder for ${tenderId}.`);
};

window.downloadCalendar = async function() {
  const tenderId = document.getElementById('reminder-tender-id').value;
  const reminderTime = document.getElementById('reminder-datetime').value;
  const notes = document.getElementById('reminder-notes').value;
  
  if (!reminderTime) {
    alert('Please select a reminder date and time');
    return;
  }
  
  try {
    const response = await fetch('/api/reminders/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfpId: tenderId,
        reminderTime,
        notes
      })
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tender-${tenderId}-reminder.ics`;
    a.click();
    
    addMessage(`✅ Calendar file downloaded for ${tenderId}. Import it into Outlook or Apple Calendar!`);
  } catch (error) {
    alert('Failed to download calendar file');
    console.error('Calendar error:', error);
  }
};

window.composeTenderEmail = function(tenderId, title, organisation, dueDate, contactEmail) {
  const dueDateStr = new Date(dueDate).toLocaleDateString('en-IN');
  const subject = `Inquiry regarding ${tenderId} - ${title}`;
  const body = `Dear ${organisation} Team,

I am writing to express our interest in the tender ${tenderId} - ${title}.

We would like to request additional information regarding:
- Technical specifications and requirements
- Submission guidelines and format
- Clarification on evaluation criteria

The deadline for this tender is ${dueDateStr}. We look forward to your response at your earliest convenience.

Best regards`;
  
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contactEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  
  window.open(gmailUrl, '_blank', 'noopener,noreferrer');
  addMessage(`✅ Gmail compose opened for ${tenderId}`);
};

// ============= ADAPTIVE CSV SYSTEM =============

// Store for active quotations that can be modified
window.activeQuotations = {};

/**
 * Handle CSV file upload for adaptive data
 * @param {File} file - The CSV file
 * @param {string} userMessage - Optional message from user about how to use this file
 */
async function handleCSVUpload(file, userMessage = '') {
  addLoadingMessage('🤖 Analyzing CSV structure with HuggingFace embeddings...');
  
  try {
    // Read file content
    const csvContent = await file.text();
    
    // Use provided message or check input field
    const userIntent = userMessage || '';
    
    // Upload to adaptive system
    const response = await fetch('/api/adaptive/upload-csv-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvContent,
        fileName: file.name,
        intent: userIntent
      })
    });
    
    const result = await response.json();
    removeLastMessage();
    
    if (result.success) {
      let html = `
        <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 16px; border-radius: 12px; color: white;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 28px;">✅</span>
            <span style="font-weight: 700; font-size: 18px;">CSV Uploaded Successfully!</span>
          </div>
          
          <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
            <div><strong>📄 File:</strong> ${file.name}</div>
            <div><strong>🏷️ Detected Type:</strong> ${result.type.replace(/_/g, ' ').toUpperCase()}</div>
            <div><strong>📊 Records:</strong> ${result.rowCount}</div>
            <div><strong>🎯 Confidence:</strong> ${(result.confidence * 100).toFixed(0)}%</div>
          </div>
      `;
      
      // Show comparison if available
      if (result.comparison && result.comparison.hasComparison) {
        html += `
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
            <div style="font-weight: 600; margin-bottom: 8px;">📈 Changes Detected:</div>
        `;
        
        if (result.comparison.changes && result.comparison.changes.length > 0) {
          html += '<div style="max-height: 200px; overflow-y: auto;">';
          result.comparison.changes.forEach(change => {
            const changeColor = change.change > 0 ? '#fbbf24' : '#34d399';
            const changeSign = change.change > 0 ? '+' : '';
            html += `
              <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <span>${change.name || change.id}</span>
                <span style="color: ${changeColor};">
                  ₹${change.defaultValue.toLocaleString()} → ₹${change.newValue.toLocaleString()} 
                  <small>(${changeSign}${change.changePercent}%)</small>
                </span>
              </div>
            `;
          });
          html += '</div>';
        } else {
          html += '<div>No price changes detected</div>';
        }
        
        html += '</div>';
      }
      
      html += `
          <div style="font-size: 13px; opacity: 0.9;">
            💡 <strong>Session Data:</strong> This data will be used for all quotations until the server restarts.
          </div>
        </div>
      `;
      
      addMessage(html, false);
      
      // Clear user input
      if (userInput) userInput.value = '';
      
    } else {
      addMessage(`
        <div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 12px; padding: 16px; color: #991b1b;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">❌</span>
            <span style="font-weight: 600;">CSV Upload Failed</span>
          </div>
          <p>${result.error}</p>
          ${result.suggestion ? `<p style="margin-top: 8px; font-size: 13px;">${result.suggestion}</p>` : ''}
          ${result.headers ? `<p style="margin-top: 8px; font-size: 12px;"><strong>Detected headers:</strong> ${result.headers.join(', ')}</p>` : ''}
        </div>
      `, false);
    }
  } catch (error) {
    removeLastMessage();
    addMessage(`
      <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
        <strong>❌ Error:</strong> ${error.message}
      </div>
    `, false);
  }
}

/**
 * Handle quotation modification from chat
 */
async function handleQuotationModification(instruction) {
  const quotationId = window.currentQuotationId;
  const quotation = window.activeQuotations[quotationId];
  
  if (!quotation) {
    addMessage(`
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; color: #92400e;">
        <strong>⚠️ No active quotation to modify.</strong>
        <p style="margin-top: 8px; font-size: 13px;">First generate a quotation, then you can modify it with instructions like:</p>
        <ul style="margin: 8px 0; padding-left: 20px; font-size: 13px;">
          <li>"increase by 10%"</li>
          <li>"make total around 5 lakhs"</li>
          <li>"set profit margin to 15%"</li>
          <li>"add 50000 to the total"</li>
        </ul>
      </div>
    `, false);
    return false;
  }
  
  addLoadingMessage('Modifying quotation...');
  
  try {
    const response = await fetch('/api/adaptive/modify-quotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        currentQuotation: quotation
      })
    });
    
    const result = await response.json();
    removeLastMessage();
    
    if (result.success) {
      // Update stored quotation
      window.activeQuotations[quotationId] = result.quotation;
      
      // Display updated quotation
      displayModifiedQuotation(result.quotation, result.modifications, result.message);
      return true;
    } else {
      addMessage(`
        <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #991b1b;">
          <strong>❌ Could not modify quotation</strong>
          <p style="margin-top: 8px; font-size: 13px;">${result.error}</p>
          ${result.suggestion ? `<pre style="background: #fee2e2; padding: 8px; border-radius: 4px; font-size: 12px; white-space: pre-wrap;">${result.suggestion}</pre>` : ''}
        </div>
      `, false);
      return false;
    }
  } catch (error) {
    removeLastMessage();
    addMessage(`❌ Error: ${error.message}`, false);
    return false;
  }
}

/**
 * Display modified quotation
 */
function displayModifiedQuotation(quotation, modifications, message) {
  let html = `
    <div style="background: linear-gradient(135deg, #8b5cf6, #6366f1); padding: 16px; border-radius: 12px; color: white;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <span style="font-size: 24px;">✏️</span>
        <span style="font-weight: 700; font-size: 16px;">Quotation Modified</span>
      </div>
      
      <div style="background: rgba(255,255,255,0.15); padding: 10px; border-radius: 8px; margin-bottom: 12px; font-size: 14px;">
        ${message}
      </div>
      
      <div style="background: white; color: #1e293b; padding: 12px; border-radius: 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
  `;
  
  for (const [key, item] of Object.entries(quotation.breakdown)) {
    const isModified = modifications?.some(m => 
      (m.type === 'material_cost' && key === 'materialCost') ||
      (m.type === 'testing_cost' && key === 'testingCost') ||
      (m.type === 'profit_margin' && key === 'profit') ||
      (m.type.includes('total') && key === 'grandTotal')
    );
    
    html += `
      <tr style="${item.highlight ? 'font-weight: bold; background: #f0fdf4;' : ''} ${isModified ? 'background: #fef3c7;' : ''}">
        <td style="padding: 6px; border-bottom: 1px solid #e5e7eb;">${item.label} ${isModified ? '✏️' : ''}</td>
        <td style="padding: 6px; border-bottom: 1px solid #e5e7eb; text-align: right;">${item.formatted}</td>
      </tr>
    `;
  }
  
  html += `
        </table>
      </div>
      
      <div style="margin-top: 12px; font-size: 13px; opacity: 0.9;">
        💡 Say more modifications or "proceed" to use this quotation.
      </div>
    </div>
  `;
  
  addMessage(html, false);
}

/**
 * Check session status
 */
window.checkAdaptiveSession = async function() {
  try {
    const response = await fetch('/api/adaptive/session-status');
    const result = await response.json();
    
    if (result.success) {
      const session = result.session;
      const overrides = Object.entries(session.activeOverrides);
      
      let html = `
        <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 16px; border-radius: 12px; color: white;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="font-size: 24px;">📊</span>
            <span style="font-weight: 700; font-size: 16px;">Adaptive Session Status</span>
          </div>
          
          <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
            <div><strong>🕐 Session Started:</strong> ${new Date(session.sessionStarted).toLocaleString()}</div>
            <div><strong>📝 Modifications:</strong> ${session.modificationsCount}</div>
          </div>
      `;
      
      if (overrides.length > 0) {
        html += `
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
            <div style="font-weight: 600; margin-bottom: 8px;">📁 Active Data Overrides:</div>
        `;
        
        for (const [type, info] of overrides) {
          html += `
            <div style="padding: 6px; margin: 4px 0; background: rgba(255,255,255,0.1); border-radius: 4px;">
              <strong>${type.replace(/_/g, ' ').toUpperCase()}</strong>
              <div style="font-size: 12px; opacity: 0.9;">
                📄 ${info.fileName} • 📊 ${info.rowCount} records • 🕐 ${new Date(info.uploadedAt).toLocaleTimeString()}
              </div>
            </div>
          `;
        }
        
        html += '</div>';
      } else {
        html += `
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; text-align: center;">
            No custom data loaded. Using default CSVs.
          </div>
        `;
      }
      
      html += `
          <div style="margin-top: 12px; font-size: 13px;">
            💡 Upload a CSV to customize testing prices or cable products for this session.
          </div>
        </div>
      `;
      
      addMessage(html, false);
    }
  } catch (error) {
    addMessage(`❌ Error checking session: ${error.message}`, false);
  }
};

/**
 * Clear adaptive session
 */
window.clearAdaptiveSession = async function() {
  try {
    const response = await fetch('/api/adaptive/clear-session', {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.success) {
      addMessage(`
        <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 12px; color: #065f46;">
          <strong>✅ ${result.message}</strong>
        </div>
      `, false);
    }
  } catch (error) {
    addMessage(`❌ Error: ${error.message}`, false);
  }
};

// Detect quotation modification requests
function isQuotationModificationRequest(message) {
  const msg = message.toLowerCase();
  const keywords = [
    'increase', 'decrease', 'raise', 'lower', 'add', 'reduce',
    'change total', 'make total', 'set total', 'profit margin',
    'material cost', 'testing cost', 'around', 'approximately',
    'double', 'half', 'bit more', 'bit less', 'higher', 'lower price'
  ];
  
  return window.currentQuotationId && keywords.some(kw => msg.includes(kw));
}
