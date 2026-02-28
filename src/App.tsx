import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'motion/react';
import { Plus, X, Shield, Swords, User, Image as ImageIcon, MessageSquare, Crosshair, Zap, Flame, Edit2, Camera, Upload, ArrowLeft } from 'lucide-react';
import { db, storage } from './firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, where, addDoc } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

interface Member {
  id: string;
  nickname: string;
  photoUrl: string;
  intro: string;
  role: string;
}

interface Photo {
  id: string;
  url: string;
  timestamp: number;
  memberId?: string;
}

// Image compression utility (Target: < 1MB)
const compressImage = (file: File, maxSizeMB: number = 1): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Max dimensions to help with compression
        const MAX_WIDTH = 1920;
        const MAX_HEIGHT = 1080;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        
        // Reduce quality until size is under maxSizeMB (approximate base64 size)
        // 1MB = 1024 * 1024 bytes. Base64 is ~33% larger than binary.
        const maxBase64Length = maxSizeMB * 1024 * 1024 * 1.33;
        
        while (dataUrl.length > maxBase64Length && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        
        resolve(dataUrl);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [albums, setAlbums] = useState<Record<string, Photo[]>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // View state: 'home' | 'album'
  const [currentView, setCurrentView] = useState<'home' | 'album'>('home');
  const [selectedAlbumMemberId, setSelectedAlbumMemberId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Form state
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [intro, setIntro] = useState('');
  const [role, setRole] = useState('Member');

  useEffect(() => {
    // Fetch members from Firestore
    const unsubscribeMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      const membersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setMembers(membersData);
    });

    return () => unsubscribeMembers();
  }, []);

  useEffect(() => {
    // Fetch photos for the selected member from Firestore
    if (currentView === 'album' && selectedAlbumMemberId) {
      const q = query(collection(db, 'photos'), where('memberId', '==', selectedAlbumMemberId));
      const unsubscribePhotos = onSnapshot(q, (snapshot) => {
        const photosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Photo));
        // Sort by timestamp descending
        photosData.sort((a, b) => b.timestamp - a.timestamp);
        setAlbums(prev => ({ ...prev, [selectedAlbumMemberId]: photosData }));
      });
      return () => unsubscribePhotos();
    }
  }, [currentView, selectedAlbumMemberId]);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setNickname('');
    setPhotoUrl('');
    setIntro('');
    setRole('Member');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (member: Member) => {
    setEditingId(member.id);
    setNickname(member.nickname.startsWith('GK_') ? member.nickname.substring(3) : member.nickname);
    setPhotoUrl(member.photoUrl.includes('picsum.photos') ? '' : member.photoUrl);
    setIntro(member.intro);
    setRole(member.role);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname || !intro) return;

    const finalNickname = nickname.startsWith('GK_') ? nickname : `GK_${nickname}`;
    const finalPhotoUrl = photoUrl || `https://picsum.photos/seed/${finalNickname}/400/400`;

    if (editingId) {
      // Edit existing member in Firestore
      await setDoc(doc(db, 'members', editingId), { 
        nickname: finalNickname, 
        photoUrl: finalPhotoUrl, 
        intro, 
        role 
      }, { merge: true });
    } else {
      // Add new member to Firestore
      await addDoc(collection(db, 'members'), { 
        nickname: finalNickname, 
        photoUrl: finalPhotoUrl, 
        intro, 
        role 
      });
    }

    setIsModalOpen(false);
  };

  const handleDeleteMember = async (id: string) => {
    // Delete member from Firestore
    await deleteDoc(doc(db, 'members', id));
  };

  const openAlbum = (memberId: string) => {
    setSelectedAlbumMemberId(memberId);
    setCurrentView('album');
    window.scrollTo(0, 0);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !selectedAlbumMemberId) return;
    
    setIsUploading(true);
    try {
      const file = e.target.files[0];
      // Compress image to < 1MB
      const compressedDataUrl = await compressImage(file, 1);
      
      // Upload to Firebase Storage
      const storageRef = ref(storage, `albums/${selectedAlbumMemberId}/${Date.now()}.jpg`);
      await uploadString(storageRef, compressedDataUrl, 'data_url');
      const downloadUrl = await getDownloadURL(storageRef);

      // Save metadata to Firestore
      await addDoc(collection(db, 'photos'), {
        memberId: selectedAlbumMemberId,
        url: downloadUrl,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error("Error compressing/uploading image:", error);
      alert("圖片上傳失敗，請確認 Firebase 資料庫權限設定。");
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const selectedMember = members.find(m => m.id === selectedAlbumMemberId);
  const currentAlbumPhotos = selectedAlbumMemberId ? (albums[selectedAlbumMemberId] || []) : [];

  return (
    <div className="min-h-screen bg-gk-bg text-white selection:bg-gk-blue selection:text-black">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-gk-bg/80 backdrop-blur-md border-b border-gk-border">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setCurrentView('home')}
          >
            <Shield className="w-8 h-8 text-gk-blue" />
            <span className="font-display font-bold text-2xl tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-gk-blue to-gk-orange">
              GK CLAN
            </span>
          </div>
          <div className="flex items-center gap-6 md:gap-8 font-display tracking-widest text-sm">
            <button onClick={() => setCurrentView('home')} className={`hover:text-gk-blue transition-colors ${currentView === 'home' ? 'text-gk-blue' : ''}`}>
              首頁 HOME
            </button>
            {/* Album Dropdown / Link */}
            <div className="relative group">
              <button className={`hover:text-gk-blue transition-colors flex items-center gap-2 ${currentView === 'album' ? 'text-gk-blue' : ''}`}>
                <Camera className="w-4 h-4" />
                個人相簿 ALBUMS
              </button>
              <div className="absolute top-full right-0 mt-4 w-48 bg-gk-surface border border-gk-border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 shadow-xl">
                {members.length === 0 ? (
                  <div className="p-4 text-gray-500 text-xs">尚無成員</div>
                ) : (
                  members.map(m => (
                    <button 
                      key={m.id}
                      onClick={() => openAlbum(m.id)}
                      className="w-full text-left px-4 py-3 hover:bg-gk-blue/10 hover:text-gk-blue border-b border-gk-border/50 last:border-0 truncate"
                    >
                      {m.nickname}
                    </button>
                  ))
                )}
              </div>
            </div>
            <button 
              onClick={handleOpenAddModal}
              className="px-6 py-2 bg-gk-blue/10 border border-gk-blue text-gk-blue hover:bg-gk-blue hover:text-black transition-all duration-300 rounded-none font-bold hidden md:flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              入隊申請
            </button>
          </div>
        </div>
      </nav>

      {currentView === 'home' ? (
        <>
          {/* Hero Section */}
          <section id="home" className="relative w-full h-screen flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 z-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,85,255,0.15)_0%,rgba(5,5,10,1)_70%)]"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gk-blue/5 rounded-full blur-[120px]"></div>
            </div>

            <div className="relative z-10 flex flex-col items-center w-full max-w-5xl px-6">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="relative w-full aspect-video max-w-4xl mx-auto rounded-2xl overflow-hidden border border-gk-blue/30 shadow-[0_0_50px_rgba(0,240,255,0.2)] bg-black flex items-center justify-center group"
              >
                <div className="absolute inset-0 w-full h-full pointer-events-none">
                  <iframe 
                    className="w-full h-full scale-[1.2]"
                    src="https://www.youtube.com/embed/5GggesYPJXw?autoplay=1&mute=1&loop=1&playlist=5GggesYPJXw&controls=0&showinfo=0&rel=0&modestbranding=1" 
                    title="GK Clan Logo Animation" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen
                  ></iframe>
                </div>
                <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_4px] z-10" />
                <div className="absolute inset-0 pointer-events-none border-2 border-gk-blue/20 rounded-2xl z-20 transition-colors group-hover:border-gk-blue/50" />
              </motion.div>

              <motion.div 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="text-center mt-12"
              >
                <h1 className="font-display text-6xl md:text-8xl font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-white via-gk-blue to-gk-dark-blue drop-shadow-[0_0_20px_rgba(0,240,255,0.5)]">
                  競爭者遊戲
                </h1>
                <p className="font-display text-xl md:text-2xl mt-6 tracking-[0.5em] text-gk-orange uppercase">
                  Competitor Game Clan
                </p>
              </motion.div>
            </div>

            <motion.div 
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gk-blue/50"
            >
              <span className="font-display text-xs tracking-widest">SCROLL</span>
              <div className="w-[1px] h-12 bg-gradient-to-b from-gk-blue/50 to-transparent"></div>
            </motion.div>
          </section>

          {/* Roster Section */}
          <section id="roster" className="py-32 relative z-10 bg-gk-bg">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-end justify-between mb-16 border-b border-gk-border pb-6">
                <div>
                  <h2 className="font-display text-4xl md:text-5xl font-bold tracking-wider text-white flex items-center gap-4">
                    <Swords className="w-10 h-10 text-gk-orange" />
                    戰隊成員
                  </h2>
                  <p className="font-display text-gk-blue tracking-widest mt-2 uppercase">Active Roster</p>
                </div>
                <div className="font-display text-4xl font-black text-gk-border">
                  {members.length.toString().padStart(2, '0')}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <AnimatePresence>
                  {members.map((member, index) => (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: index * 0.1 }}
                      className="group relative bg-gk-surface border border-gk-border hover:border-gk-blue/50 transition-colors duration-300 overflow-hidden flex flex-col"
                    >
                      <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleOpenEditModal(member)}
                          className="w-8 h-8 bg-black/50 backdrop-blur-sm border border-gk-blue/30 text-gk-blue rounded-full flex items-center justify-center hover:bg-gk-blue hover:text-black transition-colors"
                          title="編輯成員"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteMember(member.id)}
                          className="w-8 h-8 bg-black/50 backdrop-blur-sm border border-red-500/30 text-red-500 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                          title="移除成員"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="relative aspect-square overflow-hidden bg-black">
                        <div className="absolute inset-0 bg-gradient-to-t from-gk-surface via-transparent to-transparent z-10"></div>
                        <img 
                          src={member.photoUrl} 
                          alt={member.nickname}
                          className="w-full h-full object-cover object-center group-hover:scale-110 transition-transform duration-700 opacity-80 group-hover:opacity-100 grayscale group-hover:grayscale-0"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-4 left-4 z-20 px-3 py-1 bg-gk-blue/20 backdrop-blur-md border border-gk-blue/50 text-gk-blue font-display text-xs tracking-widest uppercase">
                          {member.role}
                        </div>
                      </div>

                      <div className="p-6 relative flex-1 flex flex-col">
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-gk-blue/30 m-1"></div>
                        
                        <h3 className="font-display text-2xl font-bold text-white group-hover:text-gk-blue transition-colors flex items-center gap-2">
                          <Crosshair className="w-5 h-5 text-gk-orange opacity-0 group-hover:opacity-100 transition-opacity" />
                          {member.nickname}
                        </h3>
                        
                        {/* Album Button */}
                        <button 
                          onClick={() => openAlbum(member.id)}
                          className="mt-3 inline-flex items-center gap-2 text-sm text-gk-blue/80 hover:text-gk-blue font-display tracking-widest transition-colors w-fit"
                        >
                          <Camera className="w-4 h-4" />
                          進入相簿
                        </button>

                        <p className="text-gray-400 mt-4 text-sm leading-relaxed border-l-2 border-gk-border pl-4 group-hover:border-gk-orange transition-colors flex-1">
                          {member.intro}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </section>
        </>
      ) : (
        /* Album View */
        <section className="pt-32 pb-20 min-h-screen relative z-10 bg-gk-bg">
          <div className="max-w-7xl mx-auto px-6">
            <button 
              onClick={() => setCurrentView('home')}
              className="flex items-center gap-2 text-gray-400 hover:text-gk-blue transition-colors mb-8 font-display tracking-widest"
            >
              <ArrowLeft className="w-5 h-5" />
              返回首頁 BACK
            </button>

            {selectedMember ? (
              <>
                <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 border-b border-gk-border pb-8 gap-6">
                  <div className="flex items-center gap-6">
                    <img 
                      src={selectedMember.photoUrl} 
                      alt={selectedMember.nickname}
                      className="w-24 h-24 rounded-full object-cover border-2 border-gk-blue"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <h2 className="font-display text-4xl md:text-5xl font-bold tracking-wider text-white flex items-center gap-4">
                        {selectedMember.nickname}
                      </h2>
                      <p className="font-display text-gk-orange tracking-widest mt-2 uppercase">
                        {selectedMember.role} / PERSONAL ALBUM
                      </p>
                    </div>
                  </div>
                  
                  {/* Upload Button */}
                  <div className="relative">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handlePhotoUpload}
                      disabled={isUploading}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <button 
                      disabled={isUploading}
                      className="px-6 py-3 bg-gk-blue text-black font-display font-bold tracking-widest hover:bg-white transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {isUploading ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                          <Zap className="w-5 h-5" />
                        </motion.div>
                      ) : (
                        <Upload className="w-5 h-5" />
                      )}
                      {isUploading ? '壓縮上傳中...' : '上傳照片 UPLOAD'}
                    </button>
                    <p className="text-xs text-gray-500 mt-2 text-right font-sans">自動壓縮至 1MB 以下</p>
                  </div>
                </div>

                {/* Photo Grid */}
                {currentAlbumPhotos.length === 0 ? (
                  <div className="text-center py-20 border border-dashed border-gk-border rounded-xl">
                    <Camera className="w-16 h-16 text-gk-border mx-auto mb-4" />
                    <p className="text-gray-400 font-display tracking-widest">尚無照片，趕快上傳第一張照片吧！</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                    <AnimatePresence>
                      {currentAlbumPhotos.map((photo, index) => (
                        <motion.div
                          key={photo.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: index * 0.05 }}
                          className="aspect-square bg-gk-surface border border-gk-border rounded-lg overflow-hidden group relative"
                        >
                          <img 
                            src={photo.url} 
                            alt="Album photo" 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-xs text-white/70 font-display tracking-widest">
                              {new Date(photo.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 text-red-500">找不到該成員資料</div>
            )}
          </div>
        </section>
      )}

      {/* Add/Edit Member Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-lg bg-gk-surface border border-gk-blue/30 shadow-[0_0_40px_rgba(0,240,255,0.1)] relative overflow-hidden"
            >
              <div className="p-6 border-b border-gk-border flex items-center justify-between bg-black/50">
                <h3 className="font-display text-xl font-bold text-white flex items-center gap-3">
                  <User className="w-6 h-6 text-gk-blue" />
                  {editingId ? '編輯戰隊成員' : '新增戰隊成員'}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="font-display text-sm tracking-widest text-gk-blue flex items-center gap-2">
                    <User className="w-4 h-4" /> 遊戲暱稱 NICKNAME
                  </label>
                  <input 
                    type="text" 
                    required
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="例如: Shadow"
                    className="w-full bg-black border border-gk-border focus:border-gk-blue text-white px-4 py-3 outline-none transition-colors font-sans text-lg"
                  />
                </div>

                <div className="space-y-2">
                  <label className="font-display text-sm tracking-widest text-gk-blue flex items-center gap-2">
                    <Shield className="w-4 h-4" /> 隊伍定位 ROLE
                  </label>
                  <select 
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-black border border-gk-border focus:border-gk-blue text-white px-4 py-3 outline-none transition-colors font-sans text-lg appearance-none"
                  >
                    <option value="Captain">隊長 Captain</option>
                    <option value="Assault">突擊手 Assault</option>
                    <option value="Sniper">狙擊手 Sniper</option>
                    <option value="Support">後勤支援 Support</option>
                    <option value="Member">一般成員 Member</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="font-display text-sm tracking-widest text-gk-blue flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> 照片網址 PHOTO URL (選填)
                  </label>
                  <input 
                    type="url" 
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-black border border-gk-border focus:border-gk-blue text-white px-4 py-3 outline-none transition-colors font-sans text-lg"
                  />
                  <p className="text-xs text-gray-500">若留空將自動產生預設頭像</p>
                </div>

                <div className="space-y-2">
                  <label className="font-display text-sm tracking-widest text-gk-blue flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> 自我介紹 INTRO
                  </label>
                  <textarea 
                    required
                    value={intro}
                    onChange={(e) => setIntro(e.target.value)}
                    placeholder="輸入簡短的自我介紹或戰鬥風格..."
                    rows={3}
                    className="w-full bg-black border border-gk-border focus:border-gk-blue text-white px-4 py-3 outline-none transition-colors font-sans text-lg resize-none"
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-gk-blue text-black font-display font-bold tracking-widest text-lg hover:bg-white transition-colors flex items-center justify-center gap-2"
                >
                  {editingId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                  {editingId ? '儲存變更 SAVE CHANGES' : '確認加入 JOIN CLAN'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
