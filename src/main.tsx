import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { courseFromShareToken } from './utils/course';
import { useCourseStore } from './stores/courseStore';
import './styles.css';

const shared = window.location.hash.match(/course=([^&]+)/)?.[1];
if (shared) {
  const sharedCourse = courseFromShareToken(decodeURIComponent(shared));
  if (sharedCourse) {
    useCourseStore.getState().loadCourse(sharedCourse);
    window.history.replaceState(null, '', window.location.pathname);
  }
}

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
  headings: { fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif' },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <RouterProvider router={router} />
    </MantineProvider>
  </React.StrictMode>,
);

