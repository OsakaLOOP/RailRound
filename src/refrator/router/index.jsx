import {createBrowserRouter, Navigate} from "react-router-dom";
import MainLayout from "../mainLayout";
//import TripsPage from "../pages/TripsPage";
//import MapUI from "../pages/MapUI";
//import StatsPage from "../pages/StatsPage";
//import LoginModal from "../components/LoginModal";
//import NewTripModal from "../components/NewTripModal";
//import TutorialPage from "../pages/TutorialPage";

export const router = createBrowserRouter([
    {path:"/", element: <MainLayout />, children:
        [{index: true, element: <Navigate to="/trips" replace/>},
        {path:"trips", element: <TripsPage />},
        {path:"map", element: <MapUI />},
        // map 内容实际在 MainLayout, 但是有一些 UI 组件需要悬浮.
        {path:"stats", element: <StatsPage />},
    ]},
    {
    // 登录页, 如果用户手动访问/login, 则全屏, 否则以模态框形式展示在当前页面上.
    path: "/login",
    element: <LoginModal state={{mode:"fullpage", background: null}}/>
  }
]);