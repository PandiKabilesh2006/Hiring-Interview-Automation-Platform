"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import React, { useEffect } from "react";

function SessionSync() {
  const { isLoaded, isSignedIn, signOut } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;

    if (typeof window !== "undefined") {
      let tabId = sessionStorage.getItem("portal_tab_id");
      const isNewTab = !tabId;
      if (!tabId) {
        tabId = Math.random().toString(36).substring(2);
        sessionStorage.setItem("portal_tab_id", tabId);
      }

      // Read active tabs
      let activeTabs: Record<string, number> = {};
      try {
        const raw = localStorage.getItem("portal_active_tabs");
        if (raw) activeTabs = JSON.parse(raw);
      } catch (e) {
        activeTabs = {};
      }

      // Filter out stale tabs (older than 12 seconds)
      const now = Date.now();
      const cleanTabs: Record<string, number> = {};
      for (const [id, ts] of Object.entries(activeTabs)) {
        if (now - ts < 12000) {
          cleanTabs[id] = ts;
        }
      }

      // Check if there are other active tabs
      const otherTabsOpen = Object.keys(cleanTabs).filter(id => id !== tabId).length > 0;

      if (isNewTab && !otherTabsOpen && isSignedIn) {
        console.log("[Auth] Clean session start detected (no other active tabs). Enforcing logout...");
        signOut().then(() => {
          cleanTabs[tabId!] = Date.now();
          localStorage.setItem("portal_active_tabs", JSON.stringify(cleanTabs));
        });
      } else {
        cleanTabs[tabId!] = Date.now();
        localStorage.setItem("portal_active_tabs", JSON.stringify(cleanTabs));
      }

      // Start heartbeat
      const interval = setInterval(() => {
        let currentTabs: Record<string, number> = {};
        try {
          const raw = localStorage.getItem("portal_active_tabs");
          if (raw) currentTabs = JSON.parse(raw);
        } catch {
          currentTabs = {};
        }
        currentTabs[tabId!] = Date.now();
        localStorage.setItem("portal_active_tabs", JSON.stringify(currentTabs));
      }, 5000);

      // Handle unload
      const handleUnload = () => {
        let currentTabs: Record<string, number> = {};
        try {
          const raw = localStorage.getItem("portal_active_tabs");
          if (raw) currentTabs = JSON.parse(raw);
        } catch {
          currentTabs = {};
        }
        delete currentTabs[tabId!];
        localStorage.setItem("portal_active_tabs", JSON.stringify(currentTabs));
      };

      window.addEventListener("beforeunload", handleUnload);

      return () => {
        clearInterval(interval);
        window.removeEventListener("beforeunload", handleUnload);
      };
    }
  }, [isLoaded, isSignedIn, signOut]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <SessionSync />
      {children}
    </ClerkProvider>
  );
}