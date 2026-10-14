'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase'; 
import { useRouter } from 'next/navigation';

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", 
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", 
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Cambodia", "Cameroon", "Canada", "Chile", "China", 
  "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador", "Egypt", 
  "El Salvador", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", 
  "Guatemala", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", 
  "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Libya", 
  "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta", "Mexico", "Monaco", "Mongolia", "Montenegro", "Morocco", 
  "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Nigeria", "North Korea", "Norway", "Oman", "Pakistan", "Panama", 
  "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia", "Serbia", 
  "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Syria", 
  "Taiwan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", 
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

export default function EditProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string>('');
  
  const [form, setForm] = useState({
    name: '',
    city: '',
    country: '',
    intention: '',
    gender: '',
  });

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth'); return; }
      
      setUserId(user.id);

      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setForm({
          name: data.display_name || '',
          city: data.city || '',
          country: data.country || '',
          intention: data.intention || '',
          gender: data.gender || '',
        });
      }
      setLoading(false);
    }
    loadProfile();
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      display_name: form.name,
      city: form.city,
      country: form.country,
      intention: form.intention,
      gender: form.gender,
    }).eq('id', userId);

    setSaving(false);
    if (error) {
      alert(`Error saving: ${error.message}`);
    } else {
      alert('Profile updated successfully!');
      router.push('/profile/dashboard');
    }
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#17121C', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '40px' },
    header: { padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #29202D' },
    title: { fontSize: '18px', fontWeight: '700', color: '#F2E9E4' },
    backBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '16px', cursor: 'pointer', fontWeight: '600' },
    main: { padding: '24px', display: 'flex', flexDirection: 'column' as const, gap: '20px' },
    label: { fontSize: '13px', fontWeight: '600', color: '#D4B18A', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '8px', display: 'block' },
    input: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#29202D', color: '#F2E9E4', fontSize: '15px', outline: 'none', boxSizing: 'border-box' as const },
    select: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#29202D', color: '#F2E9E4', fontSize: '15px', outline: 'none', appearance: 'none' as const, boxSizing: 'border-box' as const },
    textarea: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#29202D', color: '#F2E9E4', fontSize: '15px', outline: 'none', minHeight: '100px', resize: 'vertical' as const, boxSizing: 'border-box' as const, fontFamily: 'system-ui' },
    saveBtn: { width: '100%', padding: '18px', borderRadius: '30px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', marginTop: '20px', transition: 'all 0.2s' },
    saveBtnDisabled: { backgroundColor: '#29202D', color: '#B58A83', cursor: 'not-allowed' }
  };

  if (loading) {
    return (
      <div style={{ ...styles.container, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ color: '#D4B18A' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>← Back</button>
        <div style={styles.title}>Edit Profile</div>
        <div style={{ width: '60px' }} /> {/* Spacer */}
      </div>

      <div style={styles.main}>
        <div>
          <label style={styles.label}>Display Name</label>
          <input 
            style={styles.input} 
            value={form.name} 
            onChange={(e) => setForm({ ...form, name: e.target.value })} 
          />
        </div>

        <div>
          <label style={styles.label}>Gender</label>
          <select 
            style={styles.select} 
            value={form.gender} 
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
          >
            <option value="Man">Man</option>
            <option value="Woman">Woman</option>
            <option value="Nonbinary">Nonbinary</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Country</label>
          <select 
            style={styles.select} 
            value={form.country} 
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          >
            <option value="">-- Select Country --</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label style={styles.label}>City / District</label>
          <input 
            style={styles.input} 
            placeholder="e.g. Kathmandu" 
            value={form.city} 
            onChange={(e) => setForm({ ...form, city: e.target.value })} 
          />
        </div>

        <div>
          <label style={styles.label}>Bio / Intention</label>
          <textarea 
            style={styles.textarea} 
            placeholder="What are you looking for?" 
            value={form.intention} 
            onChange={(e) => setForm({ ...form, intention: e.target.value })} 
          />
        </div>

        <button 
          style={{ ...styles.saveBtn, ...(saving ? styles.saveBtnDisabled : {}) }} 
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}