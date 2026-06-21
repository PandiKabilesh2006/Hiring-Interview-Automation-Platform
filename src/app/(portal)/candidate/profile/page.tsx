"use client";

import { useEffect, useState, useRef } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";

interface Profile {
  name: string;
  email: string;
  global_ats_score: number | null;
  global_ats_label: string | null;
  global_ats_result: {
    suggestions?: string[];
    skills?: string[];
    strengths?: string[];
    domain?: string;
    years_experience?: number;
    explanation?: string;
  } | null;
  resume_text: string | null;
  resume_filename: string | null;
  resume_base64: string | null;
  phone: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  bio: string | null;
  global_ats_updated_at: string | null;
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = size * 0.37;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const cx = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dasharray 1.2s ease" }}
      />
      <text x={cx} y={cx + 2} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight="bold" fill="#111827">
        {score}
      </text>
      <text x={cx} y={cx + size * 0.17} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.1} fill="#9ca3af">
        /100
      </text>
    </svg>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [computing, setComputing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", linkedin_url: "", portfolio_url: "", bio: "",
  });
  const [resumeText, setResumeText] = useState("");
  const [resumeFilename, setResumeFilename] = useState("");
  const [resumeTab, setResumeTab] = useState<"paste" | "upload">("paste");
  const [autoFilled, setAutoFilled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showResumeViewer, setShowResumeViewer] = useState(false);
  const [resumeBase64, setResumeBase64] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const isPdfResume = () => resumeFilename.toLowerCase().endsWith(".pdf");

  const openResumeFile = () => {
    if (!resumeFilename) return;

    if (isPdfResume()) {
      setShowResumeViewer(true);
      return;
    }

    if (resumeBase64) {
      const link = document.createElement("a");
      link.href = resumeBase64;
      link.download = resumeFilename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    setShowResumeViewer(true);
  };

  useEffect(() => {
    fetch("/api/candidate/profile")
      .then((r) => r.json())
      .then(({ profile: p }) => {
        if (p) {
          setProfile(p);
          setForm({
            name: p.name || "",
            phone: p.phone || "",
            linkedin_url: p.linkedin_url || "",
            portfolio_url: p.portfolio_url || "",
            bio: p.bio || "",
          });
          setResumeText(p.resume_text || "");
          setResumeFilename(p.resume_filename || "");
          setResumeBase64(p.resume_base64 || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function processFile(file: File) {
    setIsUploading(true);
    setUploadProgress(10);
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) return 90;
        return prev + 10;
      });
    }, 200);

    try {
      try {
        const b64 = await getBase64(file);
        setResumeBase64(b64);
      } catch (err) {
        console.error("Failed to read file as base64", err);
      }

      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-resume", { method: "POST", body: formData });
      
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (res.ok) {
        const { text, extracted } = await res.json();
        setResumeText(text);
        setResumeFilename(file.name);
        // Auto-fill empty form fields with extracted values
        if (extracted) {
          let filled = false;
          setForm((prev) => {
            const next = {
              name: prev.name || extracted.name || prev.name,
              phone: prev.phone || extracted.phone || prev.phone,
              linkedin_url: prev.linkedin_url || extracted.linkedin_url || prev.linkedin_url,
              portfolio_url: prev.portfolio_url || extracted.github_url || prev.portfolio_url,
              bio: prev.bio,
            };
            filled = Object.entries(next).some(
              ([k, v]) => v !== (prev as Record<string, string>)[k]
            );
            return next;
          });
          if (filled) {
            setAutoFilled(true);
            setTimeout(() => setAutoFilled(false), 4000);
          }
        }
      } else {
        // Fallback: read as text for plain text files
        if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
          const text = await file.text();
          setResumeText(text);
          setResumeFilename(file.name);
        } else {
          alert("Could not parse file. Please paste your resume as text instead.");
        }
      }
    } catch {
      alert("An error occurred while uploading the file.");
    } finally {
      clearInterval(progressInterval);
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
      }, 500);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!resumeFilename) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (resumeFilename) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && /\.(pdf|docx?|txt)$/i.test(droppedFile.name)) {
      await processFile(droppedFile);
    } else if (droppedFile) {
      alert("Invalid file format. Please upload a PDF, DOC, DOCX, or TXT file.");
    }
  };

  const handleRemoveResume = () => {
    setResumeText("");
    setResumeFilename("");
    setResumeBase64("");
    if (fileRef.current) {
      fileRef.current.value = "";
    }
    setShowRemoveConfirm(false);
  };

  async function handleSave(recomputeAts = false) {
    setSaving(true);
    if (recomputeAts) setComputing(true);
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          resumeText: resumeText || null,
          resumeFilename: resumeFilename || null,
          resumeBase64: resumeBase64 || null,
          recomputeAts,
        }),
      });
      if (res.ok) {
        const { profile: p, globalAts } = await res.json();
        setProfile({ ...p, ...(globalAts ? {
          global_ats_score: globalAts.score,
          global_ats_label: globalAts.label,
          global_ats_result: globalAts,
          global_ats_updated_at: new Date().toISOString(),
        } : {}) });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
      setComputing(false);
    }
  }

  const atsScore = profile?.global_ats_score;
  const atsResult = profile?.global_ats_result;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-500 text-sm mt-1">Keep your profile updated for better ATS scores</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {saved ? "Saved ✓" : saving && !computing ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !resumeText}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
          >
            {computing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Computing…
              </>
            ) : "Save & Compute ATS"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Profile Form */}
        <div className="lg:col-span-2 space-y-5">
          {autoFilled && (
            <div className="flex items-center gap-2 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-800">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Fields auto-filled from your resume. Review and save.
            </div>
          )}
          {/* Basic Info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Personal Information</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={profile?.email || ""} disabled
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">LinkedIn URL</label>
                <input type="url" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                  placeholder="https://linkedin.com/in/…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Portfolio / GitHub URL</label>
                <input type="url" value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                  placeholder="https://github.com/…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Bio / Summary</label>
                <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3} placeholder="Brief professional summary…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
          </div>

          {/* Resume Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Resume</h2>
              {resumeFilename && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{resumeFilename}</span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 w-fit">
              {(["paste", "upload"] as const).map((t) => (
                <button key={t} onClick={() => setResumeTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    resumeTab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}>
                  {t === "paste" ? "Paste Text" : "Upload File"}
                </button>
              ))}
            </div>

            {resumeTab === "paste" ? (
              <>
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  rows={12}
                  placeholder="Paste your full resume here…&#10;&#10;Include: summary, experience, education, skills, projects, certifications"
                  className="w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
                />
                {resumeText && (
                  <p className="text-xs text-gray-400 mt-2 text-right">{resumeText.split(/\s+/).length} words</p>
                )}
              </>
            ) : (
              <div
                onClick={() => {
                  if (resumeFilename) {
                    openResumeFile();
                  } else if (!isUploading) {
                    fileRef.current?.click();
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                  isUploading
                    ? "border-teal-400 bg-teal-50/10 cursor-default"
                    : resumeText && resumeFilename
                    ? "border-emerald-200 bg-emerald-50/5 hover:border-emerald-400 hover:bg-emerald-50/20 cursor-pointer"
                    : isDragging
                    ? "border-teal-500 bg-teal-50/50 scale-[1.01] shadow-md shadow-teal-50/20 cursor-pointer"
                    : "border-gray-200 hover:border-teal-400 hover:bg-teal-50/30 cursor-pointer"
                }`}
                title={resumeFilename ? `Click to open ${resumeFilename}` : undefined}
              >
                {isUploading ? (
                  <div className="py-2 flex flex-col items-center justify-center animate-pulse">
                    <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center mb-3 animate-spin">
                      <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700">Uploading and parsing resume...</p>
                    <p className="text-xs text-gray-400 mt-1">Extracting contact information</p>

                    <div className="w-64 bg-gray-100 rounded-full h-2 mt-4 overflow-hidden border border-gray-100/50">
                      <div
                        className="bg-teal-600 h-full rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-teal-600 font-bold mt-1.5">{uploadProgress}%</p>
                  </div>
                ) : resumeText && resumeFilename ? (
                  <div className="py-2 flex flex-col items-center justify-center animate-scale-in">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRemoveConfirm(true);
                      }}
                      className="absolute top-3 right-3 w-7 h-7 bg-red-150 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-red-400 z-10"
                      title="Remove resume"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>

                    <p className="text-sm font-semibold text-gray-800 truncate max-w-xs px-2" title={resumeFilename}>
                      {resumeFilename}
                    </p>
                    
                    <p className="text-xs text-gray-400 mt-1">
                      {resumeText.split(/\s+/).length} words
                    </p>
                    <p className="text-xs text-teal-600 mt-2 font-medium bg-teal-50 px-2.5 py-0.5 rounded-full animate-pulse">
                      ✓ Uploaded
                    </p>
                  </div>
                ) : (
                  <div className="py-2">
                    <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-600">Drop your resume here or click to upload</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX, or TXT</p>
                  </div>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="hidden" onChange={handleFileUpload} />
          </div>
        </div>

        {/* Right: ATS Score Panel */}
        <div className="space-y-5">
          {/* Score Widget */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Global Resume ATS Score</h2>
            <p className="text-xs text-gray-400 mb-4">Based on your uploaded resume quality</p>
            {atsScore !== null && atsScore !== undefined ? (
              <div className="flex flex-col items-center">
                <ScoreRing score={Math.round(atsScore)} />
                <p className="text-xs text-gray-500 font-medium mt-1">Global Resume ATS Score: {Math.round(atsScore)}/100</p>
                <div className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                  atsScore >= 70 ? "bg-emerald-50 text-emerald-700" :
                  atsScore >= 50 ? "bg-amber-50 text-amber-700" :
                  "bg-red-50 text-red-700"
                }`}>
                  {profile?.global_ats_label}
                </div>
                {atsResult?.domain && (
                  <p className="text-xs text-gray-500 mt-2">Domain: {atsResult.domain}</p>
                )}
                {atsResult?.years_experience !== undefined && (
                  <p className="text-xs text-gray-500">~{atsResult.years_experience} yrs experience</p>
                )}
                {profile?.global_ats_updated_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    Updated {new Date(profile.global_ats_updated_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="w-20 h-20 rounded-full border-4 border-gray-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl text-gray-300">?</span>
                </div>
                <p className="text-sm text-gray-500">Not evaluated yet</p>
                <p className="text-xs text-gray-400 mt-1">Add your resume and click "Save & Compute ATS"</p>
              </div>
            )}
          </div>

          {/* Skills */}
          {atsResult?.skills && atsResult.skills.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Detected Skills</h3>
              <div className="flex flex-wrap gap-1.5">
                {atsResult.skills.slice(0, 15).map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {atsResult?.suggestions && atsResult.suggestions.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">How to Improve</h3>
              <ul className="space-y-2.5">
                {atsResult.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-xs text-gray-700 leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Explanation */}
          {atsResult?.explanation && (
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-1.5">ATS Analysis</p>
              <p className="text-xs text-gray-700 leading-relaxed">{atsResult.explanation}</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={showRemoveConfirm}
        title="Remove Resume"
        message="Are you sure you want to remove your resume? This will clear your current resume text and filename."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger={true}
        onConfirm={handleRemoveResume}
        onCancel={() => setShowRemoveConfirm(false)}
      />

      {/* Resume Viewer Modal */}
      {showResumeViewer && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowResumeViewer(false)} />

          {/* Modal Content */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-scale-in flex flex-col h-[85vh] max-h-[85vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Resume Preview</h3>
                <p className="text-xs text-gray-500 mt-0.5">{resumeFilename}</p>
              </div>
              <button
                onClick={() => setShowResumeViewer(false)}
                className="w-7 h-7 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors focus:outline-none"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Document display container */}
            <div className="overflow-hidden flex-1 bg-gray-50 flex flex-col h-full">
              {resumeBase64 && isPdfResume() ? (
                <iframe src={resumeBase64} className="w-full h-full border-none flex-1" />
              ) : (
                <div className="p-6 overflow-y-auto flex-1">
                  {resumeBase64 && (
                    <button
                      type="button"
                      onClick={openResumeFile}
                      className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 mb-4 font-semibold hover:bg-teal-100 transition-colors"
                    >
                      Open original {resumeFilename.split(".").pop()?.toUpperCase()} file
                    </button>
                  )}
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed select-text">
                    {resumeText}
                  </pre>
                </div>
              )}
            </div>


          </div>
        </div>
      )}
    </div>
  );
}
