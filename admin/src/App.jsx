import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- Client-Side AES-GCM Encryption Helper ---
async function encryptText(text, masterKeyText) {
  if (!text) return '';
  try {
    const encoder = new TextEncoder();
    const keyData = await crypto.subtle.digest('SHA-256', encoder.encode(masterKeyText));
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(text)
    );
    const combined = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertextBuffer), iv.byteLength);

    let binary = '';
    for (let i = 0; i < combined.byteLength; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.error("Encryption failed:", err);
    throw new Error("Failed to encrypt. Verify cryptography support in browser.");
  }
}

export default function App() {
  // Connection states
  const [supabaseUrl, setSupabaseUrl] = useState(localStorage.getItem('rg_sb_url') || 'https://ukjufspvbriaudkjjrjs.supabase.co');
  const [supabaseKey, setSupabaseKey] = useState(localStorage.getItem('rg_sb_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVranVmc3B2YnJpYXVka2pqcmpzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ0MDk2OSwiZXhwIjoyMDk3MDE2OTY5fQ.VmQ-BqSjxZuAVP6Br7xl6ryT_OIjNU73Lrok36xOGxc');
  const [encryptionKey, setEncryptionKey] = useState(localStorage.getItem('rg_crypt_key') || 'Harshi@2009Maan');
  const [isConnected, setIsConnected] = useState(false);
  const [supabase, setSupabase] = useState(null);

  // App Navigation
  const [activeTab, setActiveTab] = useState('analytics');

  // Loaded database states
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, totalRequests: 0, dailyRequests: 0 });
  const [users, setUsers] = useState([]);
  const [apiConfigs, setApiConfigs] = useState([]);
  const [settings, setSettings] = useState({});
  const [backups, setBackups] = useState([]);
  
  // UI States
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);

  // Form inputs
  const [providerForms, setProviderForms] = useState({});
  const [promptForms, setPromptForms] = useState({});
  const [botSettingsForm, setBotSettingsForm] = useState({ token: '', webhook: '', maintenance: 'false', workerDomain: '' });

  // Connect to Supabase
  const handleConnect = async (e) => {
    e.preventDefault();
    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      showStatus("Please fill in all fields.", "error");
      return;
    }

    setLoading(true);
    try {
      const client = createClient(supabaseUrl, supabaseKey);
      
      // Test the client connection by running a query
      const { data, error } = await client.from('settings').select('key').limit(1);
      
      if (error) throw error;

      setSupabase(client);
      setIsConnected(true);
      
      // Save credentials in browser localStorage
      localStorage.setItem('rg_sb_url', supabaseUrl);
      localStorage.setItem('rg_sb_key', supabaseKey);
      localStorage.setItem('rg_crypt_key', encryptionKey);
      
      showStatus("Connected to Supabase successfully!", "success");
    } catch (err) {
      console.error(err);
      showStatus("Connection failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setSupabase(null);
    localStorage.removeItem('rg_sb_url');
    localStorage.removeItem('rg_sb_key');
    localStorage.removeItem('rg_crypt_key');
  };

  const showStatus = (text, type = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Fetch all dashboard data
  const loadData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // 1. Fetch Stats
      const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
      const { count: activeUserCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active');
      const { count: logCount } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true });
      
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: dailyLogCount } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true }).gte('timestamp', oneDayAgo);

      setStats({
        totalUsers: userCount || 0,
        activeUsers: activeUserCount || 0,
        totalRequests: logCount || 0,
        dailyRequests: dailyLogCount || 0
      });

      // 2. Fetch Users, Preferences & Memory combined
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select(`
          id, username, status, created_at,
          preferences ( reply_style, language, personality ),
          memory ( summary )
        `)
        .order('created_at', { ascending: false });

      if (usersErr) throw usersErr;
      setUsers(usersData || []);

      // 3. Fetch API Configurations
      const { data: configsData, error: configsErr } = await supabase.from('api_configs').select('*');
      if (configsErr) throw configsErr;
      setApiConfigs(configsData || []);
      
      const forms = {};
      configsData.forEach(c => {
        forms[c.provider] = { apiKey: '', modelName: c.model_name || '', status: c.status };
      });
      setProviderForms(forms);

      // 4. Fetch settings
      const { data: settingsData, error: settingsErr } = await supabase.from('settings').select('*');
      if (settingsErr) throw settingsErr;
      
      const settingsObj = {};
      settingsData.forEach(s => {
        settingsObj[s.key] = s.value;
      });
      setSettings(settingsObj);
      setPromptForms({
        prompt_system_core: settingsObj.prompt_system_core || '',
        prompt_style_casual: settingsObj.prompt_style_casual || '',
        prompt_style_funny: settingsObj.prompt_style_funny || '',
        prompt_style_flirty: settingsObj.prompt_style_flirty || '',
        prompt_style_confident: settingsObj.prompt_style_confident || ''
      });
      setBotSettingsForm({
        token: '',
        webhook: settingsObj.telegram_webhook_url || '',
        maintenance: settingsObj.maintenance_mode || 'false',
        workerDomain: ''
      });

      // 5. Fetch Backups list
      const { data: backupsData } = await supabase.from('backups').select('*').order('created_at', { ascending: false });
      setBackups(backupsData || []);

    } catch (err) {
      console.error(err);
      showStatus("Error loading data: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected) {
      loadData();
    }
  }, [isConnected]);

  // --- Toggle User Ban ---
  const toggleUserBan = async (userId, currentStatus) => {
    setActionLoading(true);
    const newStatus = currentStatus === 'active' ? 'banned' : 'active';
    try {
      const { error } = await supabase
        .from('users')
        .update({ status: newStatus })
        .eq('id', userId);

      if (error) throw error;
      showStatus(`User status updated to ${newStatus}.`, "success");
      loadData();
    } catch (e) {
      showStatus("Failed to update status: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Save API Config ---
  const saveProviderConfig = async (provider) => {
    setActionLoading(true);
    try {
      const form = providerForms[provider];
      const updates = {
        model_name: form.modelName,
        updated_at: new Date().toISOString()
      };

      // If a new API key was inputted, encrypt it on the client side before writing
      if (form.apiKey.trim() !== '') {
        const encrypted = await encryptText(form.apiKey.trim(), encryptionKey);
        updates.api_key = encrypted;
      }

      const { error } = await supabase
        .from('api_configs')
        .update(updates)
        .eq('provider', provider);

      if (error) throw error;
      showStatus(`${provider.toUpperCase()} configurations updated.`, "success");
      
      // Update local forms
      setProviderForms(prev => ({
        ...prev,
        [provider]: { ...prev[provider], apiKey: '' }
      }));
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to save provider config: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Toggle Active Provider ---
  const toggleProviderStatus = async (provider, currentStatus) => {
    setActionLoading(true);
    try {
      const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
      
      if (nextStatus === 'active') {
        // Deactivate all others first (since only one provider can be active)
        const { error: resetError } = await supabase
          .from('api_configs')
          .update({ status: 'inactive' })
          .neq('provider', provider);

        if (resetError) throw resetError;
      }

      const { error } = await supabase
        .from('api_configs')
        .update({ status: nextStatus })
        .eq('provider', provider);

      if (error) throw error;
      showStatus(`${provider.toUpperCase()} set to ${nextStatus}.`, "success");
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to update status: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Save Prompt Templates ---
  const savePrompts = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const promises = Object.entries(promptForms).map(([key, value]) => {
        return supabase
          .from('settings')
          .upsert({ key, value });
      });

      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) throw new Error("Some prompts failed to save.");
      
      showStatus("System prompt templates saved successfully.", "success");
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to save prompts: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Update Bot Management Settings ---
  const saveBotSettings = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const updates = [
        supabase.from('settings').upsert({ key: 'maintenance_mode', value: botSettingsForm.maintenance })
      ];

      if (botSettingsForm.webhook) {
        updates.push(supabase.from('settings').upsert({ key: 'telegram_webhook_url', value: botSettingsForm.webhook }));
      }

      if (botSettingsForm.token.trim() !== '') {
        const encrypted = await encryptText(botSettingsForm.token.trim(), encryptionKey);
        updates.push(supabase.from('settings').upsert({ key: 'telegram_bot_token', value: encrypted }));
      }

      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw new Error("Failed to save settings to database.");

      showStatus("Bot configuration saved.", "success");
      
      // Update local form
      setBotSettingsForm(prev => ({ ...prev, token: '' }));
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to save bot settings: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Set Telegram Webhook API (calls the Worker) ---
  const registerTelegramWebhook = async () => {
    if (!botSettingsForm.workerDomain) {
      showStatus("Please enter your Worker Domain to register.", "error");
      return;
    }

    setActionLoading(true);
    try {
      // Fetch encrypted token from settings
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

      if (error || !data.value) {
        throw new Error("No Telegram Bot token found in Supabase settings.");
      }

      // Call the Worker webhook setup endpoint
      const workerUrl = `https://${botSettingsForm.workerDomain}/admin/setup-webhook`;
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botTokenEncrypted: data.value,
          workerDomain: botSettingsForm.workerDomain
        })
      });

      const resJson = await response.json();
      if (!response.ok || !resJson.success) {
        throw new Error(resJson.error || "Worker returned failure.");
      }

      showStatus("Webhook successfully set to Worker endpoint!", "success");
      
      // Save webhook to settings table
      await supabase.from('settings').upsert({ key: 'telegram_webhook_url', value: `https://${botSettingsForm.workerDomain}/webhook` });
      loadData();
    } catch (e) {
      showStatus("Failed to register webhook: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Trigger Worker Cache Clear ---
  const triggerWorkerCacheClear = async () => {
    if (!botSettingsForm.workerDomain && !settings.telegram_webhook_url) return;
    try {
      let domain = botSettingsForm.workerDomain;
      if (!domain && settings.telegram_webhook_url) {
        domain = new URL(settings.telegram_webhook_url).host;
      }

      const response = await fetch(`https://${domain}/admin/clear-cache`);
      if (response.ok) {
        console.log("Worker cache refreshed.");
      }
    } catch (e) {
      console.warn("Failed to notify Worker to clear cache. Cache will self-clear after TTL (60s).");
    }
  };

  // --- Create Database Backup (JSON Export) ---
  const handleCreateBackup = async () => {
    setActionLoading(true);
    try {
      // Export tables
      const [usersRes, prefRes, memRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('preferences').select('*'),
        supabase.from('memory').select('*')
      ]);

      const backupObj = {
        users: usersRes.data || [],
        preferences: prefRes.data || [],
        memory: memRes.data || [],
        exported_at: new Date().toISOString()
      };

      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(backupObj, null, 2))}`;
      const downloadAnchor = document.createElement('a');
      const filename = `replygenius_backup_${new Date().toISOString().split('T')[0]}.json`;
      
      downloadAnchor.setAttribute("href", jsonString);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      // Insert backup log into database
      await supabase.from('backups').insert([{ filename }]);
      showStatus("Backup generated and downloaded.", "success");
      loadData();
    } catch (e) {
      showStatus("Backup creation failed: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // Filter users list
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return (
      String(u.id).includes(q) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.memory && u.memory.summary && u.memory.summary.toLowerCase().includes(q))
    );
  });

  // Render Login / Connection Form
  if (!isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px' }}>
        <div className="glass-card fade-in" style={{ width: '100%', maxWidth: '480px', padding: '36px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div className="logo-icon" style={{ margin: '0 auto 16px', width: '56px', height: '56px', borderRadius: '16px', fontSize: '1.8rem' }}>
              <i className="fa-solid fa-brain"></i>
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800 }}>ReplyGenius AI</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>Admin Command Center Connection</p>
          </div>

          {statusMessage && (
            <div className={`alert ${statusMessage.type === 'error' ? 'btn-danger' : 'alert-info'}`} style={{ marginBottom: '20px' }}>
              <i className={statusMessage.type === 'error' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info'}></i>
              <span>{statusMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label>Supabase Project URL</label>
              <input 
                type="url" 
                className="form-control" 
                placeholder="https://your-project.supabase.co" 
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label>Supabase Service Role JWT API Key</label>
              <input 
                type="password" 
                className="form-control" 
                placeholder="eyJh..." 
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                required
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Required to manage table entries and bypass RLS policy.</span>
            </div>

            <div className="form-group">
              <label>Secret Master Encryption Key</label>
              <input 
                type="password" 
                className="form-control" 
                placeholder="Must match SECRET_ENCRYPTION_KEY in Worker" 
                value={encryptionKey}
                onChange={e => setEncryptionKey(e.target.value)}
                required
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Used to encrypt/decrypt bot tokens client-side.</span>
            </div>

            <button type="submit" className="btn btn-primary" style={{ padding: '12px', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <span>Connect Dashboard <i className="fa-solid fa-arrow-right-to-bracket"></i></span>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render Connected Panel
  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon"><i className="fa-solid fa-brain"></i></div>
          <div>
            <span className="logo-text">Genius AI</span>
            <span className="logo-tag">MVP</span>
          </div>
        </div>

        <nav className="nav-list">
          <li className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
            <i className="fa-solid fa-chart-line"></i>
            <span>Analytics</span>
          </li>
          <li className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            <i className="fa-solid fa-users"></i>
            <span>User Manager</span>
          </li>
          <li className={`nav-item ${activeTab === 'api' ? 'active' : ''}`} onClick={() => setActiveTab('api')}>
            <i className="fa-solid fa-key"></i>
            <span>API Providers</span>
          </li>
          <li className={`nav-item ${activeTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveTab('prompts')}>
            <i className="fa-solid fa-terminal"></i>
            <span>Prompts</span>
          </li>
          <li className={`nav-item ${activeTab === 'bot' ? 'active' : ''}`} onClick={() => setActiveTab('bot')}>
            <i className="fa-solid fa-robot"></i>
            <span>Bot Configuration</span>
          </li>
          <li className={`nav-item ${activeTab === 'backups' ? 'active' : ''}`} onClick={() => setActiveTab('backups')}>
            <i className="fa-solid fa-database"></i>
            <span>Backups</span>
          </li>
        </nav>

        <div className="sidebar-footer">
          <div className="admin-profile">
            <div className="admin-avatar">A</div>
            <div className="admin-info" style={{ marginRight: 'auto' }}>
              <p className="name">Bot Admin</p>
              <p className="role">Service Owner</p>
            </div>
            <button className="btn" style={{ padding: '8px', minWidth: '32px', height: '32px', justifyContent: 'center' }} onClick={handleDisconnect} title="Disconnect Session">
              <i className="fa-solid fa-power-off" style={{ color: '#ef4444' }}></i>
            </button>
          </div>
        </div>
      </aside>

      {/* Main dashboard content */}
      <main className="main-content">
        <header className="header-panel">
          <div className="header-title">
            <h1 style={{ textTransform: 'capitalize' }}>{activeTab} Management</h1>
            <p>Admin Control Panel for ReplyGenius AI Telegram Assistant</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn" onClick={loadData} disabled={loading}>
              {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-rotate"></i>} Refresh Data
            </button>
          </div>
        </header>

        {/* Global status alert banner */}
        {statusMessage && (
          <div className={`alert ${statusMessage.type === 'error' ? 'btn-danger' : 'alert-info'} fade-in`}>
            <i className={statusMessage.type === 'error' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info'}></i>
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* --- Tab 1: Analytics --- */}
        {activeTab === 'analytics' && (
          <div className="fade-in">
            <div className="stats-grid">
              <div className="glass-card stat-card">
                <div className="stat-icon purple"><i className="fa-solid fa-users"></i></div>
                <div className="stat-data">
                  <span className="stat-value">{stats.totalUsers}</span>
                  <span className="stat-label">Total Users</span>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon cyan"><i className="fa-solid fa-user-check"></i></div>
                <div className="stat-data">
                  <span className="stat-value">{stats.activeUsers}</span>
                  <span className="stat-label">Active Users</span>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon pink"><i className="fa-solid fa-paper-plane"></i></div>
                <div className="stat-data">
                  <span className="stat-value">{stats.totalRequests}</span>
                  <span className="stat-label">Total Requests</span>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon yellow"><i className="fa-solid fa-bolt"></i></div>
                <div className="stat-data">
                  <span className="stat-value">{stats.dailyRequests}</span>
                  <span className="stat-label">24h Requests</span>
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="glass-card">
                <h3 className="section-title"><i className="fa-solid fa-server"></i> System Health</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'between', marginBottom: '6px', fontSize: '0.9rem' }}>
                      <span>Supabase Connection</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--status-active)' }}>Healthy</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px' }}>
                      <div style={{ width: '100%', height: '100%', background: 'var(--status-active)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'between', marginBottom: '6px', fontSize: '0.9rem' }}>
                      <span>Active AI API Provider</span>
                      <span style={{ marginLeft: 'auto', color: apiConfigs.some(c => c.status === 'active') ? 'var(--status-active)' : 'var(--status-banned)' }}>
                        {apiConfigs.find(c => c.status === 'active')?.provider.toUpperCase() || 'NONE'}
                      </span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px' }}>
                      <div style={{ width: apiConfigs.some(c => c.status === 'active') ? '100%' : '0%', height: '100%', background: 'var(--status-active)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'between', marginBottom: '6px', fontSize: '0.9rem' }}>
                      <span>Maintenance Mode</span>
                      <span style={{ marginLeft: 'auto', color: settings.maintenance_mode === 'true' ? 'var(--status-warning)' : 'var(--status-active)' }}>
                        {settings.maintenance_mode === 'true' ? 'Enabled' : 'Offline (Inactive)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-card">
                <h3 className="section-title"><i className="fa-solid fa-chart-pie"></i> Usage Overview</h3>
                <div style={{ color: 'var(--text-secondary)', padding: '10px 0', fontSize: '0.95rem' }}>
                  <p style={{ marginBottom: '10px' }}>• Free Tier Usage Limit: <b>10 Generations / Day</b></p>
                  <p style={{ marginBottom: '10px' }}>• Database Size: <b>Lightweight</b> (smart memory compression logs conversation summaries instead of raw chat logs)</p>
                  <p style={{ marginBottom: '10px' }}>• Encrypted Credentials: <b>Enabled</b> (secrets encrypted via Web Crypto client-side)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Tab 2: User Manager --- */}
        {activeTab === 'users' && (
          <div className="glass-card fade-in">
            <div className="search-bar">
              <div className="search-input-wrapper">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Search users by ID, username, language, or memory..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="table-wrapper">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>User ID / Username</th>
                    <th>Default Style</th>
                    <th>Memory Summary</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No users found matching query.</td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => (
                      <tr key={u.id}>
                        <td>
                          <div className="user-profile-cell">
                            <div className="user-avatar">{u.username ? u.username[0].toUpperCase() : 'U'}</div>
                            <div>
                              <p style={{ fontWeight: 600 }}>{u.username || 'Anonymous'}</p>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {u.id}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="status-pill active" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--accent-purple)', borderColor: 'rgba(139,92,246,0.2)' }}>
                            {u.preferences?.reply_style || 'Casual'}
                          </span>
                        </td>
                        <td style={{ maxWidth: '300px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={u.memory?.summary || 'No memory recorded'}>
                            {u.memory?.summary || 'New account. No chat summaries yet.'}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${u.status === 'active' ? 'active' : 'banned'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td>
                          <button 
                            className={`btn btn-danger ${u.status === 'active' ? '' : 'btn-primary'}`} 
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            onClick={() => toggleUserBan(u.id, u.status)}
                            disabled={actionLoading}
                          >
                            {u.status === 'active' ? 'Ban' : 'Unban'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- Tab 3: API Providers --- */}
        {activeTab === 'api' && (
          <div className="config-grid fade-in">
            {apiConfigs.map(c => {
              const form = providerForms[c.provider] || { apiKey: '', modelName: '', status: 'inactive' };
              return (
                <div key={c.provider} className={`glass-card provider-card ${c.status === 'active' ? 'active-provider' : ''}`}>
                  <div className="provider-card-header">
                    <div className="provider-info">
                      <div className="provider-logo">
                        {c.provider === 'openai' && <i className="fa-solid fa-circle-dot" style={{ color: '#10b981' }}></i>}
                        {c.provider === 'gemini' && <i className="fa-solid fa-sparkles" style={{ color: '#3b82f6' }}></i>}
                        {c.provider === 'claude' && <i className="fa-solid fa-fire" style={{ color: '#f97316' }}></i>}
                        {c.provider === 'openrouter' && <i className="fa-solid fa-route" style={{ color: '#8b5cf6' }}></i>}
                        {c.provider === 'groq' && <i className="fa-solid fa-bolt" style={{ color: '#f59e0b' }}></i>}
                      </div>
                      <span className="provider-name">{c.provider}</span>
                    </div>

                    <div className="switch-wrapper" style={{ margin: 0 }}>
                      <label className="toggle-switch">
                        <input 
                          type="checkbox" 
                          checked={c.status === 'active'}
                          onChange={() => toggleProviderStatus(c.provider, c.status)}
                          disabled={actionLoading}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Default Model Name</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. gpt-4o-mini" 
                      value={form.modelName}
                      onChange={e => setProviderForms({
                        ...providerForms,
                        [c.provider]: { ...form, modelName: e.target.value }
                      })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Set New API Key {c.api_key && <span style={{ color: 'var(--status-active)' }}>(Key Set ✓)</span>}</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="••••••••••••••••••••••••" 
                      value={form.apiKey}
                      onChange={e => setProviderForms({
                        ...providerForms,
                        [c.provider]: { ...form, apiKey: e.target.value }
                      })}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Key is encrypted client-side using Web Crypto AES-GCM.</span>
                  </div>

                  <button 
                    className="btn btn-primary" 
                    style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}
                    onClick={() => saveProviderConfig(c.provider)}
                    disabled={actionLoading}
                  >
                    Save {c.provider.toUpperCase()} Settings
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* --- Tab 4: Prompt Templates --- */}
        {activeTab === 'prompts' && (
          <form onSubmit={savePrompts} className="glass-card fade-in prompt-list">
            <h3 className="section-title"><i className="fa-solid fa-code"></i> AI System Prompt Control</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '10px' }}>
              These prompt strings dictate how the AI generates replies. Modifying these values immediately affects all subsequent Telegram bot requests.
            </p>

            <div className="prompt-card">
              <div className="prompt-card-header">
                <span className="prompt-card-title">Core System Prompt</span>
              </div>
              <textarea 
                className="textarea-field" 
                value={promptForms.prompt_system_core}
                onChange={e => setPromptForms({ ...promptForms, prompt_system_core: e.target.value })}
                required
              />
            </div>

            <div className="grid-2">
              <div className="prompt-card">
                <span className="prompt-card-title">Casual Mode Parameter</span>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_casual}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_casual: e.target.value })}
                  required
                />
              </div>

              <div className="prompt-card">
                <span className="prompt-card-title">Funny Mode Parameter</span>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_funny}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_funny: e.target.value })}
                  required
                />
              </div>

              <div className="prompt-card">
                <span className="prompt-card-title">Flirty Mode Parameter</span>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_flirty}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_flirty: e.target.value })}
                  required
                />
              </div>

              <div className="prompt-card">
                <span className="prompt-card-title">Confident Mode Parameter</span>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_confident}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_confident: e.target.value })}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ padding: '12px', justifyContent: 'center', width: '220px' }} disabled={actionLoading}>
              Save Prompt Configurations
            </button>
          </form>
        )}

        {/* --- Tab 5: Bot Configuration --- */}
        {activeTab === 'bot' && (
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            {/* Database values update */}
            <form onSubmit={saveBotSettings} style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
              <h3 className="section-title"><i className="fa-solid fa-sliders"></i> Bot Environment Settings</h3>
              
              <div className="form-group">
                <label>Set Telegram Bot Token {settings.telegram_bot_token && <span style={{ color: 'var(--status-active)' }}>(Token Set ✓)</span>}</label>
                <input 
                  type="password" 
                  className="form-control" 
                  placeholder="••••••••••••••••••••••••" 
                  value={botSettingsForm.token}
                  onChange={e => setBotSettingsForm({ ...botSettingsForm, token: e.target.value })}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Token is encrypted on the client side using Web Crypto AES-GCM before database write.</span>
              </div>

              <div className="form-group">
                <label>Registered Webhook URL</label>
                <input 
                  type="url" 
                  className="form-control" 
                  placeholder="https://your-worker.your-subdomain.workers.dev/webhook" 
                  value={botSettingsForm.webhook}
                  onChange={e => setBotSettingsForm({ ...botSettingsForm, webhook: e.target.value })}
                />
              </div>

              <div className="switch-wrapper">
                <span className="switch-label">Enable Maintenance Mode</span>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={botSettingsForm.maintenance === 'true'}
                    onChange={e => setBotSettingsForm({ ...botSettingsForm, maintenance: e.target.checked ? 'true' : 'false' })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', padding: '10px 24px' }} disabled={actionLoading}>
                Update Bot Settings
              </button>
            </form>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)' }} />

            {/* Cloudflare Worker Webhook Setup Trigger */}
            <div style={{ maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h3 className="section-title"><i className="fa-solid fa-circle-nodes"></i> Telegram Webhook Linker</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Telegram needs to be notified where to send chat messages. Provide your deployed Cloudflare Worker domain name below, and the control panel will trigger the webhook registration API directly with Telegram.
              </p>

              <div className="form-group">
                <label>Cloudflare Worker Host Domain (No https:// or /webhook)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="replygenius-bot.your-username.workers.dev" 
                  value={botSettingsForm.workerDomain}
                  onChange={e => setBotSettingsForm({ ...botSettingsForm, workerDomain: e.target.value })}
                />
              </div>

              <button 
                className="btn btn-primary" 
                style={{ alignSelf: 'flex-start', padding: '10px 24px', background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))', boxShadow: '0 4px 12px var(--accent-cyan-glow)' }}
                onClick={registerTelegramWebhook}
                disabled={actionLoading}
              >
                Register Webhook Endpoint
              </button>
            </div>
          </div>
        )}

        {/* --- Tab 6: Backups --- */}
        {activeTab === 'backups' && (
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <h3 className="section-title"><i className="fa-solid fa-cloud-arrow-down"></i> Backup Registry</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '600px' }}>
              Create a local backup file containing all user configurations, reply style preferences, and AI conversation context summaries. The data is exported as standard JSON.
            </p>

            <div>
              <button className="btn btn-primary" style={{ padding: '12px 24px' }} onClick={handleCreateBackup} disabled={actionLoading}>
                <i className="fa-solid fa-file-export"></i> Trigger Backup & Download
              </button>
            </div>

            <h4 style={{ fontSize: '1.2rem', marginTop: '10px' }}>Recent Backup Operations Log</h4>
            <div className="table-wrapper">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Backup Filename</th>
                    <th>Created Timestamp (UTC)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No backups logged.</td>
                    </tr>
                  ) : (
                    backups.map(b => (
                      <tr key={b.id}>
                        <td><i className="fa-solid fa-file-code" style={{ marginRight: '8px', color: 'var(--accent-purple)' }}></i> {b.filename}</td>
                        <td>{new Date(b.created_at).toLocaleString()}</td>
                        <td><span className="status-pill active">Downloaded</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
