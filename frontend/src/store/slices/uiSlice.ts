import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UiState {
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  searchOpen: boolean;
  mobileMenuOpen: boolean;
  notificationCount: number;
}

const uiInitial: UiState = {
  theme: (localStorage.getItem('theme') as UiState['theme']) || 'light',
  sidebarOpen: true,
  searchOpen: false,
  mobileMenuOpen: false,
  notificationCount: 0,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState: uiInitial,
  reducers: {
    setTheme: (state, action: PayloadAction<UiState['theme']>) => {
      state.theme = action.payload;
      localStorage.setItem('theme', action.payload);
    },
    toggleSidebar: (state) => { state.sidebarOpen = !state.sidebarOpen; },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => { state.sidebarOpen = action.payload; },
    toggleSearch: (state) => { state.searchOpen = !state.searchOpen; },
    toggleMobileMenu: (state) => { state.mobileMenuOpen = !state.mobileMenuOpen; },
    setNotificationCount: (state, action: PayloadAction<number>) => {
      state.notificationCount = action.payload;
    },
  },
});

export const { 
  setTheme, 
  toggleSidebar, 
  setSidebarOpen, 
  toggleSearch, 
  toggleMobileMenu, 
  setNotificationCount 
} = uiSlice.actions;
export default uiSlice.reducer;
