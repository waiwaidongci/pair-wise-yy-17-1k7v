import { Navigate, createBrowserRouter } from 'react-router-dom';
import App from '../App';
import { DesignerView } from '../views/DesignerView';
import { RoutesLibraryView } from '../views/RoutesLibraryView';
import { ScheduleView } from '../views/ScheduleView';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/schedule" replace /> },
      { path: 'schedule', element: <ScheduleView /> },
      { path: 'designer', element: <DesignerView /> },
      { path: 'routes', element: <RoutesLibraryView /> },
      { path: '*', element: <Navigate to="/schedule" replace /> },
    ],
  },
]);

