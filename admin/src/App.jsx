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
  const [plans, setPlans] = useState([]);
  const [apiConfigs, setApiConfigs] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyForm, setNewKeyForm] = useState({}); // { [provider]: { label: '', key: '' } }
  const [settings, setSettings] = useState({});
  const [backups, setBackups] = useState([]);
  
  // UI States
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);

  // Modal / Chat Log States
  const [activeChatUser, setActiveChatUser] = useState(null);
  const [chatLogs, setChatLogs] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Form inputs
  const [providerForms, setProviderForms] = useState({});
  const [promptForms, setPromptForms] = useState({});
  const [promptAiInputs, setPromptAiInputs] = useState({});
  const [promptAiLoading, setPromptAiLoading] = useState({});
  const [botSettingsForm, setBotSettingsForm] = useState({ token: '', webhook: '', maintenance: 'false', workerDomain: '', freeDailyLimit: '10', logChannelId: '' });
  
  // Plans Editor inputs
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [planForm, setPlanForm] = useState({ name: '', price: '0', offer_price: '', billing_period: 'monthly', daily_limit: '10', allow_screenshots: false, allow_premium_styles: false });
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [createPlanForm, setCreatePlanForm] = useState({ id: '', name: '', price: '199', offer_price: '', billing_period: 'monthly', daily_limit: '-1', allow_screenshots: true, allow_premium_styles: true });

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
      const { data, error } = await client.from('settings').select('key').limit(1);
      if (error) throw error;

      setSupabase(client);
      setIsConnected(true);
      
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

      // 2. Fetch Plans list
      const { data: plansData, error: plansErr } = await supabase.from('plans').select('*').order('created_at', { ascending: true });
      if (plansErr) throw plansErr;
      setPlans(plansData || []);

      // 3. Fetch Users combined with Plans
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select(`
          id, username, status, plan_id, created_at,
          plans ( name, price, offer_price, daily_limit, allow_screenshots, allow_premium_styles ),
          preferences ( reply_style, language, personality ),
          memory ( summary )
        `)
        .order('created_at', { ascending: false });

      if (usersErr) throw usersErr;
      setUsers(usersData || []);

      // 4. Fetch API Configurations
      const { data: configsData, error: configsErr } = await supabase.from('api_configs').select('*');
      if (configsErr) throw configsErr;
      setApiConfigs(configsData || []);
      
      const forms = {};
      configsData.forEach(c => {
        forms[c.provider] = { apiKey: '', modelName: c.model_name || '', status: c.status };
      });
      setProviderForms(forms);

      // Fetch all API keys from the api_keys table
      const { data: keysData, error: keysErr } = await supabase.from('api_keys').select('*').order('created_at', { ascending: true });
      if (keysErr) throw keysErr;
      setApiKeys(keysData || []);

      // 5. Fetch settings
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
        workerDomain: '',
        freeDailyLimit: settingsObj.free_tier_daily_limit || '10',
        logChannelId: settingsObj.telegram_log_channel_id || ''
      });

      // 6. Fetch Backups list
      const { data: backupsData } = await supabase.from('backups').select('*').order('created_at', { ascending: false });
      setBackups(backupsData || []);

    } catch (err) {
      console.error(err);
      showStatus("Error loading data: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

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

  // --- Change User Plan ---
  const changeUserPlan = async (userId, planId) => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ plan_id: planId })
        .eq('id', userId);

      if (error) throw error;
      showStatus("User plan updated successfully.", "success");
      loadData();
    } catch (e) {
      showStatus("Failed to update plan: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Load Chat History Modal ---
  const openChatLogs = async (user) => {
    setActiveChatUser(user);
    setChatLoading(true);
    setChatLogs([]);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user.id)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      setChatLogs(data || []);
    } catch (e) {
      showStatus("Failed to load chat history: " + e.message, "error");
    } finally {
      setChatLoading(false);
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

  // --- Add API Key to pool ---
  const addApiKey = async (e, provider) => {
    e.preventDefault();
    const form = newKeyForm[provider] || { label: '', key: '' };
    if (!form.key.trim()) {
      showStatus("Please enter an API key.", "error");
      return;
    }

    setActionLoading(true);
    try {
      const encrypted = await encryptText(form.key.trim(), encryptionKey);
      const insertData = {
        provider,
        api_key: encrypted,
        label: form.label.trim() || `Key - ${new Date().toLocaleDateString()}`,
        status: 'active'
      };

      const { error } = await supabase.from('api_keys').insert([insertData]);
      if (error) throw error;

      showStatus(`API key added to ${provider} pool successfully.`, "success");
      setNewKeyForm(prev => ({
        ...prev,
        [provider]: { label: '', key: '' }
      }));
      
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to add API key: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Delete API Key from pool ---
  const deleteApiKey = async (keyId) => {
    if (!confirm("Are you sure you want to delete this API key?")) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.from('api_keys').delete().eq('id', keyId);
      if (error) throw error;
      showStatus("API key deleted successfully.", "success");
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to delete key: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Toggle API Key Status ---
  const toggleApiKeyStatus = async (keyId, currentStatus) => {
    setActionLoading(true);
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      const { error } = await supabase
        .from('api_keys')
        .update({ status: newStatus })
        .eq('id', keyId);

      if (error) throw error;
      showStatus(`API key status updated to ${newStatus}.`, "success");
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to update key status: " + e.message, "error");
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

  // --- AI Generate Prompt ---
  const handleAiGeneratePrompt = async (promptType) => {
    const instruction = promptAiInputs[promptType];
    if (!instruction || instruction.trim() === '') {
      showStatus("Please write a modification description first.", "error");
      return;
    }

    setPromptAiLoading(prev => ({ ...prev, [promptType]: true }));
    try {
      let domain = botSettingsForm.workerDomain;
      if (!domain && settings.telegram_webhook_url) {
        domain = new URL(settings.telegram_webhook_url).host;
      }

      if (!domain) {
        throw new Error("Worker domain name is required to call AI generator. Set it in Bot Configuration.");
      }

      const response = await fetch(`https://${domain}/admin/generate-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, promptType })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to generate prompt.");
      }

      // Populate prompt text area
      setPromptForms(prev => ({
        ...prev,
        [`prompt_style_${promptType}`]: data.prompt,
        ...(promptType === 'core' ? { prompt_system_core: data.prompt } : {})
      }));
      
      // Clear input
      setPromptAiInputs(prev => ({ ...prev, [promptType]: '' }));
      showStatus("Prompt generated! Review it below and click Save.", "success");
    } catch (e) {
      showStatus(e.message, "error");
    } finally {
      setPromptAiLoading(prev => ({ ...prev, [promptType]: false }));
    }
  };

  // --- Update Bot Management Settings ---
  const saveBotSettings = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const updates = [
        supabase.from('settings').upsert({ key: 'maintenance_mode', value: botSettingsForm.maintenance }),
        supabase.from('settings').upsert({ key: 'free_tier_daily_limit', value: botSettingsForm.freeDailyLimit }),
        supabase.from('settings').upsert({ key: 'telegram_log_channel_id', value: botSettingsForm.logChannelId })
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
      setBotSettingsForm(prev => ({ ...prev, token: '' }));
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to save bot settings: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Set Telegram Webhook API ---
  const registerTelegramWebhook = async () => {
    if (!botSettingsForm.workerDomain) {
      showStatus("Please enter your Worker Domain to register.", "error");
      return;
    }

    setActionLoading(true);
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

      if (error || !data.value) {
        throw new Error("No Telegram Bot token found in Supabase settings.");
      }

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
      if (response.ok) console.log("Worker cache refreshed.");
    } catch (e) {
      console.warn("Failed to notify Worker to clear cache. Cache will self-clear after TTL (60s).");
    }
  };

  // --- Edit Plan ---
  const editPlan = (plan) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name,
      price: String(plan.price),
      offer_price: plan.offer_price !== null ? String(plan.offer_price) : '',
      billing_period: plan.billing_period || 'monthly',
      daily_limit: String(plan.daily_limit),
      allow_screenshots: plan.allow_screenshots || false,
      allow_premium_styles: plan.allow_premium_styles || false
    });
  };

  // --- Save Plan ---
  const savePlan = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const updates = {
        name: planForm.name,
        price: parseFloat(planForm.price),
        offer_price: planForm.offer_price.trim() !== '' ? parseFloat(planForm.offer_price) : null,
        billing_period: planForm.billing_period,
        daily_limit: parseInt(planForm.daily_limit),
        allow_screenshots: planForm.allow_screenshots,
        allow_premium_styles: planForm.allow_premium_styles
      };

      const { error } = await supabase
        .from('plans')
        .update(updates)
        .eq('id', editingPlanId);

      if (error) throw error;
      showStatus("Plan configuration updated.", "success");
      setEditingPlanId(null);
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to update plan: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Create Plan ---
  const handleCreatePlan = async (e) => {
    e.preventDefault();
    if (!createPlanForm.id || !createPlanForm.name) {
      showStatus("Please fill in ID and Name for the new plan.", "error");
      return;
    }

    setActionLoading(true);
    try {
      const inserts = {
        id: createPlanForm.id.toLowerCase().replace(/[^a-z0-9_]/g, ''),
        name: createPlanForm.name,
        price: parseFloat(createPlanForm.price),
        offer_price: createPlanForm.offer_price.trim() !== '' ? parseFloat(createPlanForm.offer_price) : null,
        billing_period: createPlanForm.billing_period,
        daily_limit: parseInt(createPlanForm.daily_limit),
        allow_screenshots: createPlanForm.allow_screenshots,
        allow_premium_styles: createPlanForm.allow_premium_styles,
        status: 'active'
      };

      const { error } = await supabase.from('plans').insert([inserts]);
      if (error) throw error;

      showStatus("New custom plan created successfully!", "success");
      setShowCreatePlan(false);
      setCreatePlanForm({ id: '', name: '', price: '199', offer_price: '', billing_period: 'monthly', daily_limit: '-1', allow_screenshots: true, allow_premium_styles: true });
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to create plan: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Delete Plan ---
  const deletePlan = async (planId) => {
    if (planId === 'free') {
      showStatus("The default Free Plan cannot be deleted.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to delete the plan '${planId}'? Users currently assigned to this plan will revert to the Free Plan.`)) {
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase.from('plans').delete().eq('id', planId);
      if (error) throw error;
      showStatus("Plan deleted.", "success");
      loadData();
      triggerWorkerCacheClear();
    } catch (e) {
      showStatus("Failed to delete plan: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // --- Create Database Backup (JSON Export) ---
  const handleCreateBackup = async () => {
    setActionLoading(true);
    try {
      const [usersRes, prefRes, memRes, msgRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('preferences').select('*'),
        supabase.from('memory').select('*'),
        supabase.from('messages').select('*')
      ]);

      const backupObj = {
        users: usersRes.data || [],
        preferences: prefRes.data || [],
        memory: memRes.data || [],
        messages: msgRes.data || [],
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

      await supabase.from('backups').insert([{ filename }]);
      showStatus("Backup generated and downloaded.", "success");
      loadData();
    } catch (e) {
      showStatus("Backup creation failed: " + e.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return (
      String(u.id).includes(q) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.memory && u.memory.summary && u.memory.summary.toLowerCase().includes(q))
    );
  });

  // Connection form (Not Connected state)
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
            </div>

            <button type="submit" className="btn btn-primary" style={{ padding: '12px', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <span>Connect Dashboard <i className="fa-solid fa-arrow-right-to-bracket"></i></span>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Connected state
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
          <li className={`nav-item ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
            <i className="fa-solid fa-gem"></i>
            <span>Plans Editor</span>
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
            <span>Bot Config</span>
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
            <h1 style={{ textTransform: 'capitalize' }}>{activeTab === 'api' ? 'API Provider' : activeTab} Settings</h1>
            <p>Admin Control Panel for ReplyGenius AI Telegram Assistant</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn" onClick={loadData} disabled={loading}>
              {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-rotate"></i>} Refresh Data
            </button>
          </div>
        </header>

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
                  <p style={{ marginBottom: '10px' }}>• Free Tier Daily Limit: <b>{settings.free_tier_daily_limit || 10} Requests</b></p>
                  <p style={{ marginBottom: '10px' }}>• Telegram Log Channel ID: <b>{settings.telegram_log_channel_id || 'Not configured'}</b></p>
                  <p style={{ marginBottom: '10px' }}>• Chat Log Database: <b>Active (message details tracked)</b></p>
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
                    <th>Plan Tier</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No users found matching query.</td>
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
                        <td style={{ maxWidth: '240px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={u.memory?.summary || 'No memory'}>
                            {u.memory?.summary || 'New account. No chat summaries yet.'}
                          </div>
                        </td>
                        <td>
                          <select 
                            value={u.plan_id || 'free'}
                            className="form-control"
                            style={{ padding: '6px 12px', fontSize: '0.8rem', width: '130px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}
                            onChange={e => changeUserPlan(u.id, e.target.value)}
                            disabled={actionLoading}
                          >
                            {plans.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`status-pill ${u.status === 'active' ? 'active' : 'banned'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              className="btn" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              onClick={() => openChatLogs(u)}
                            >
                              <i className="fa-solid fa-comments"></i> Chat
                            </button>
                            <button 
                              className={`btn btn-danger ${u.status === 'active' ? '' : 'btn-primary'}`} 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              onClick={() => toggleUserBan(u.id, u.status)}
                              disabled={actionLoading}
                            >
                              {u.status === 'active' ? 'Ban' : 'Unban'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- Tab 3: Plans Editor --- */}
        {activeTab === 'plans' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Define plans, set regular or special promotional offer prices, customize daily limits, and grant screenshot or premium style rights.
              </p>
              <button className="btn btn-primary" onClick={() => setShowCreatePlan(!showCreatePlan)}>
                <i className={`fa-solid ${showCreatePlan ? 'fa-xmark' : 'fa-plus'}`}></i> {showCreatePlan ? 'Cancel' : 'Create Custom Plan'}
              </button>
            </div>

            {/* Create Custom Plan Section */}
            {showCreatePlan && (
              <form onSubmit={handleCreatePlan} className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '700px' }}>
                <h3 className="section-title"><i className="fa-solid fa-folder-plus"></i> Create New Plan Tier</h3>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Plan ID (lowercase, alphanumeric, unique)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. gold_tier, special_offer"
                      value={createPlanForm.id}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, id: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Plan Name</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. VIP Gold Plan"
                      value={createPlanForm.name}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, name: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label>Regular Price (INR)</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="e.g. 299"
                      value={createPlanForm.price}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Offer Price (INR) - <i>Optional</i></label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="Leave blank if no promotion"
                      value={createPlanForm.offer_price}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, offer_price: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label>Billing Period</label>
                    <select 
                      className="form-control"
                      value={createPlanForm.billing_period}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, billing_period: e.target.value })}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="one-time">One-time</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Daily Request Limit (<i>-1 for Unlimited</i>)</label>
                    <input 
                      type="number" 
                      className="form-control"
                      value={createPlanForm.daily_limit}
                      onChange={e => setCreatePlanForm({ ...createPlanForm, daily_limit: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '36px', marginTop: '10px' }}>
                  <div className="switch-wrapper" style={{ gap: '12px' }}>
                    <span className="switch-label">Allow Screenshot Analysis</span>
                    <label className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={createPlanForm.allow_screenshots}
                        onChange={e => setCreatePlanForm({ ...createPlanForm, allow_screenshots: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  <div className="switch-wrapper" style={{ gap: '12px' }}>
                    <span className="switch-label">Allow Premium Styles (Flirty/Confident)</span>
                    <label className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={createPlanForm.allow_premium_styles}
                        onChange={e => setCreatePlanForm({ ...createPlanForm, allow_premium_styles: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', padding: '10px 24px' }} disabled={actionLoading}>
                  Create Plan Tier
                </button>
              </form>
            )}

            {/* Plans List Grid */}
            <div className="config-grid">
              {plans.map(p => (
                <div key={p.id} className="glass-card provider-card">
                  {editingPlanId === p.id ? (
                    <form onSubmit={savePlan} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
                        Editing Plan: {p.id.toUpperCase()}
                      </div>
                      
                      <div className="form-group">
                        <label>Plan Name</label>
                        <input 
                          type="text" 
                          className="form-control" 
                          value={planForm.name} 
                          onChange={e => setPlanForm({ ...planForm, name: e.target.value })} 
                          required 
                        />
                      </div>
                      
                      <div className="grid-2">
                        <div className="form-group">
                          <label>Regular Price</label>
                          <input 
                            type="number" 
                            className="form-control" 
                            value={planForm.price} 
                            onChange={e => setPlanForm({ ...planForm, price: e.target.value })} 
                            required 
                          />
                        </div>
                        <div className="form-group">
                          <label>Offer Price</label>
                          <input 
                            type="number" 
                            className="form-control" 
                            placeholder="None"
                            value={planForm.offer_price} 
                            onChange={e => setPlanForm({ ...planForm, offer_price: e.target.value })} 
                          />
                        </div>
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label>Billing Period</label>
                          <select 
                            className="form-control" 
                            value={planForm.billing_period}
                            onChange={e => setPlanForm({ ...planForm, billing_period: e.target.value })}
                          >
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                            <option value="one-time">One-time</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Daily Limit</label>
                          <input 
                            type="number" 
                            className="form-control" 
                            value={planForm.daily_limit} 
                            onChange={e => setPlanForm({ ...planForm, daily_limit: e.target.value })} 
                            required 
                          />
                        </div>
                      </div>

                      <div className="switch-wrapper">
                        <span className="switch-label">Allow Screenshots</span>
                        <label className="toggle-switch">
                          <input 
                            type="checkbox" 
                            checked={planForm.allow_screenshots}
                            onChange={e => setPlanForm({ ...planForm, allow_screenshots: e.target.checked })}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>

                      <div className="switch-wrapper">
                        <span className="switch-label">Allow Premium Styles</span>
                        <label className="toggle-switch">
                          <input 
                            type="checkbox" 
                            checked={planForm.allow_premium_styles}
                            onChange={e => setPlanForm({ ...planForm, allow_premium_styles: e.target.checked })}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                        <button type="submit" className="btn btn-primary" style={{ flexGrow: 1, justifyContent: 'center' }} disabled={actionLoading}>Save</button>
                        <button type="button" className="btn" style={{ flexGrow: 1, justifyContent: 'center' }} onClick={() => setEditingPlanId(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="provider-card-header">
                        <div className="provider-info">
                          <span className="provider-name" style={{ fontSize: '1.25rem' }}>{p.name}</span>
                          <span className="provider-badge" style={{ background: p.id === 'free' ? 'var(--border-light)' : 'rgba(245,158,11,0.15)', color: p.id === 'free' ? 'var(--text-secondary)' : 'var(--status-warning)', borderColor: 'transparent' }}>
                            {p.id.toUpperCase()}
                          </span>
                        </div>
                        {p.id !== 'free' && (
                          <button className="btn btn-danger" style={{ padding: '6px', minWidth: '28px', height: '28px', justifyContent: 'center', borderColor: 'transparent' }} onClick={() => deletePlan(p.id)} title="Delete Plan">
                            <i className="fa-solid fa-trash-can" style={{ fontSize: '0.85rem' }}></i>
                          </button>
                        )}
                      </div>

                      <div style={{ margin: '8px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                            ₹{p.offer_price !== null ? p.offer_price : p.price}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>/{p.billing_period}</span>
                        </div>
                        {p.offer_price !== null && (
                          <p style={{ color: 'var(--status-warning)', fontSize: '0.8rem', fontWeight: 600 }}>
                            <s>Regular price ₹{p.price}</s> (Special Offer Active)
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Daily Limits:</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{p.daily_limit === -1 ? 'Unlimited' : `${p.daily_limit} replies`}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Screenshots:</span>
                          <span style={{ fontWeight: 'bold', color: p.allow_screenshots ? 'var(--status-active)' : 'var(--status-banned)' }}>
                            {p.allow_screenshots ? 'Allowed' : 'Locked'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Premium Styles:</span>
                          <span style={{ fontWeight: 'bold', color: p.allow_premium_styles ? 'var(--status-active)' : 'var(--status-banned)' }}>
                            {p.allow_premium_styles ? 'Access' : 'Locked'}
                          </span>
                        </div>
                      </div>

                      <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }} onClick={() => editPlan(p)}>
                        <i className="fa-solid fa-pen-to-square"></i> Edit Plan Config
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- Tab 4: API Providers --- */}
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

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '20px 0' }} />
                  
                  {/* API Key Pool Manager */}
                  <div className="key-pool-section">
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className="fa-solid fa-key" style={{ color: 'var(--accent-purple)' }}></i>
                      <span>API Key Pool</span>
                      <span className="badge" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--accent-purple)', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px' }}>
                        {(apiKeys.filter(k => k.provider === c.provider) || []).length} keys
                      </span>
                    </h4>
                    
                    {/* Keys list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                      {(apiKeys.filter(k => k.provider === c.provider) || []).map(k => (
                        <div key={k.id} className="key-pool-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '8px', gap: '10px' }}>
                          <div style={{ flexGrow: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{k.label}</p>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>ID: {k.id} • Created {new Date(k.created_at).toLocaleDateString()}</p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <span className={`status-pill ${k.status === 'active' ? 'active' : 'banned'}`} style={{ fontSize: '0.7rem', padding: '2px 6px', cursor: 'pointer' }} onClick={() => toggleApiKeyStatus(k.id, k.status)}>
                              {k.status}
                            </span>
                            <button className="btn btn-danger" style={{ padding: '4px', minWidth: '24px', height: '24px', justifyContent: 'center', border: 'none', background: 'transparent' }} onClick={() => deleteApiKey(k.id)} title="Delete Key">
                              <i className="fa-solid fa-trash-can" style={{ fontSize: '0.75rem', color: '#ef4444' }}></i>
                            </button>
                          </div>
                        </div>
                      ))}
                      {(apiKeys.filter(k => k.provider === c.provider) || []).length === 0 && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', margin: '8px 0' }}>No keys in pool. Fallback legacy key will be used.</p>
                      )}
                    </div>

                    {/* Add Key Form */}
                    <form onSubmit={(e) => addApiKey(e, c.provider)} style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--border-light)' }}>
                      <p style={{ fontSize: '0.78rem', fontWeight: 600, margin: '0 0 4px 0' }}>Add Key to Pool</p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          type="text" 
                          className="form-control" 
                          style={{ padding: '6px 10px', fontSize: '0.8rem', flexGrow: 1 }}
                          placeholder="Label (e.g. Primary Key)" 
                          value={newKeyForm[c.provider]?.label || ''}
                          onChange={e => setNewKeyForm({
                            ...newKeyForm,
                            [c.provider]: { ...(newKeyForm[c.provider] || { label: '', key: '' }), label: e.target.value }
                          })}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          type="password" 
                          className="form-control" 
                          style={{ padding: '6px 10px', fontSize: '0.8rem', flexGrow: 2 }}
                          placeholder="API Key" 
                          value={newKeyForm[c.provider]?.key || ''}
                          onChange={e => setNewKeyForm({
                            ...newKeyForm,
                            [c.provider]: { ...(newKeyForm[c.provider] || { label: '', key: '' }), key: e.target.value }
                          })}
                        />
                        <button type="submit" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} disabled={actionLoading}>
                          Add
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* --- Tab 5: Prompt Templates --- */}
        {activeTab === 'prompts' && (
          <form onSubmit={savePrompts} className="glass-card fade-in prompt-list">
            <h3 className="section-title"><i className="fa-solid fa-code"></i> AI System Prompt Control</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '10px' }}>
              These prompt strings dictate how the AI generates replies. You can edit them manually or describe changes to have the AI generate the prompt instructions for you automatically.
            </p>

            {/* Core Prompt */}
            <div className="prompt-card">
              <div className="prompt-card-header">
                <span className="prompt-card-title">Core System Prompt</span>
                <div style={{ display: 'flex', gap: '8px', width: '380px' }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                    placeholder="Describe core improvements..."
                    value={promptAiInputs['core'] || ''}
                    onChange={e => setPromptAiInputs({ ...promptAiInputs, core: e.target.value })}
                  />
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ padding: '6px 12px', background: 'var(--bg-tertiary)', fontSize: '0.8rem', flexShrink: 0 }}
                    onClick={() => handleAiGeneratePrompt('core')}
                    disabled={promptAiLoading['core']}
                  >
                    {promptAiLoading['core'] ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-wand-magic-sparkles"></i> AI Gen</>}
                  </button>
                </div>
              </div>
              <textarea 
                className="textarea-field" 
                value={promptForms.prompt_system_core}
                onChange={e => setPromptForms({ ...promptForms, prompt_system_core: e.target.value })}
                required
              />
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)' }} />

            <div className="grid-2">
              {/* Casual Prompt */}
              <div className="prompt-card">
                <div className="prompt-card-header">
                  <span className="prompt-card-title">Casual Mode Parameter</span>
                  <div style={{ display: 'flex', gap: '6px', width: '220px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                      placeholder="Describe tone..."
                      value={promptAiInputs['casual'] || ''}
                      onChange={e => setPromptAiInputs({ ...promptAiInputs, casual: e.target.value })}
                    />
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ padding: '4px 8px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', flexShrink: 0 }}
                      onClick={() => handleAiGeneratePrompt('casual')}
                      disabled={promptAiLoading['casual']}
                    >
                      {promptAiLoading['casual'] ? <i className="fa-solid fa-spinner fa-spin"></i> : 'AI Gen'}
                    </button>
                  </div>
                </div>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_casual}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_casual: e.target.value })}
                  required
                />
              </div>

              {/* Funny Prompt */}
              <div className="prompt-card">
                <div className="prompt-card-header">
                  <span className="prompt-card-title">Funny Mode Parameter</span>
                  <div style={{ display: 'flex', gap: '6px', width: '220px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                      placeholder="Describe style..."
                      value={promptAiInputs['funny'] || ''}
                      onChange={e => setPromptAiInputs({ ...promptAiInputs, funny: e.target.value })}
                    />
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ padding: '4px 8px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', flexShrink: 0 }}
                      onClick={() => handleAiGeneratePrompt('funny')}
                      disabled={promptAiLoading['funny']}
                    >
                      {promptAiLoading['funny'] ? <i className="fa-solid fa-spinner fa-spin"></i> : 'AI Gen'}
                    </button>
                  </div>
                </div>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_funny}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_funny: e.target.value })}
                  required
                />
              </div>

              {/* Flirty Prompt */}
              <div className="prompt-card">
                <div className="prompt-card-header">
                  <span className="prompt-card-title">Flirty Mode Parameter</span>
                  <div style={{ display: 'flex', gap: '6px', width: '220px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                      placeholder="Describe vibe..."
                      value={promptAiInputs['flirty'] || ''}
                      onChange={e => setPromptAiInputs({ ...promptAiInputs, flirty: e.target.value })}
                    />
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ padding: '4px 8px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', flexShrink: 0 }}
                      onClick={() => handleAiGeneratePrompt('flirty')}
                      disabled={promptAiLoading['flirty']}
                    >
                      {promptAiLoading['flirty'] ? <i className="fa-solid fa-spinner fa-spin"></i> : 'AI Gen'}
                    </button>
                  </div>
                </div>
                <textarea 
                  className="textarea-field" 
                  value={promptForms.prompt_style_flirty}
                  onChange={e => setPromptForms({ ...promptForms, prompt_style_flirty: e.target.value })}
                  required
                />
              </div>

              {/* Confident Prompt */}
              <div className="prompt-card">
                <div className="prompt-card-header">
                  <span className="prompt-card-title">Confident Mode Parameter</span>
                  <div style={{ display: 'flex', gap: '6px', width: '220px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                      placeholder="Describe attitude..."
                      value={promptAiInputs['confident'] || ''}
                      onChange={e => setPromptAiInputs({ ...promptAiInputs, confident: e.target.value })}
                    />
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ padding: '4px 8px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', flexShrink: 0 }}
                      onClick={() => handleAiGeneratePrompt('confident')}
                      disabled={promptAiLoading['confident']}
                    >
                      {promptAiLoading['confident'] ? <i className="fa-solid fa-spinner fa-spin"></i> : 'AI Gen'}
                    </button>
                  </div>
                </div>
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

        {/* --- Tab 6: Bot Configuration --- */}
        {activeTab === 'bot' && (
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
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

              <div className="grid-2">
                <div className="form-group">
                  <label>Free Tier Daily Request Limit</label>
                  <input 
                    type="number" 
                    className="form-control" 
                    placeholder="10" 
                    value={botSettingsForm.freeDailyLimit}
                    onChange={e => setBotSettingsForm({ ...botSettingsForm, freeDailyLimit: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Telegram Log Channel/Group ID</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. -100123456789" 
                    value={botSettingsForm.logChannelId}
                    onChange={e => setBotSettingsForm({ ...botSettingsForm, logChannelId: e.target.value })}
                  />
                </div>
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

        {/* --- Tab 7: Backups --- */}
        {activeTab === 'backups' && (
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <h3 className="section-title"><i className="fa-solid fa-cloud-arrow-down"></i> Backup Registry</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '600px' }}>
              Create a local backup file containing all user configurations, plans, reply style preferences, and AI conversation context summaries. The data is exported as standard JSON.
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

      {/* --- Overlay Modal: Live Chat History Viewer --- */}
      {activeChatUser && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(5, 5, 15, 0.85)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          padding: '20px'
        }} className="fade-in">
          <div className="glass-card" style={{
            width: '100%', maxWidth: '600px', height: '80vh',
            display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid var(--border-light)'
            }}>
              <div>
                <h3 style={{ fontSize: '1.25rem' }}>Chat History Log</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  User: <b>{activeChatUser.username || 'Anonymous'}</b> | ID: <code>{activeChatUser.id}</code>
                </p>
              </div>
              <button className="btn" style={{ padding: '8px', minWidth: '32px', height: '32px', justifyContent: 'center' }} onClick={() => setActiveChatUser(null)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Modal Messages Body */}
            <div style={{
              flexGrow: 1, overflowY: 'auto', padding: '24px',
              display: 'flex', flexDirection: 'column', gap: '16px',
              background: 'rgba(5, 5, 15, 0.4)'
            }}>
              {chatLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <i className="fa-solid fa-spinner fa-spin fa-2xl" style={{ marginRight: '8px' }}></i> Loading conversations...
                </div>
              ) : chatLogs.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  No messages logged in database for this user yet.
                </div>
              ) : (
                chatLogs.map(msg => {
                  const isUser = msg.sender === 'user';
                  return (
                    <div 
                      key={msg.id} 
                      style={{
                        alignSelf: isUser ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-end' : 'flex-start'
                      }}
                    >
                      <div 
                        style={{
                          background: isUser ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                          color: 'white',
                          padding: '12px 16px',
                          borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                          border: isUser ? 'none' : '1px solid var(--border-light)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                          wordBreak: 'break-word',
                          fontSize: '0.92rem'
                        }}
                      >
                        {/* Render user image if present in message metadata */}
                        {msg.metadata?.image_url && (
                          <div style={{ marginBottom: '10px' }}>
                            <a href={msg.metadata.image_url} target="_blank" rel="noopener noreferrer">
                              <img 
                                src={msg.metadata.image_url} 
                                alt="Screenshot" 
                                style={{
                                  maxWidth: '100%',
                                  maxHeight: '200px',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  cursor: 'zoom-in',
                                  display: 'block'
                                }} 
                              />
                            </a>
                          </div>
                        )}
                        {msg.content}
                      </div>
                      
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', padding: '0 4px' }}>
                        {msg.metadata?.style && <span style={{ color: 'var(--accent-cyan)', marginRight: '6px', fontWeight: 'bold' }}>{msg.metadata.style.toUpperCase()}</span>}
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px', borderTop: '1px solid var(--border-light)',
              display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-secondary)'
            }}>
              <button className="btn" style={{ padding: '8px 20px' }} onClick={() => setActiveChatUser(null)}>Close Viewer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
