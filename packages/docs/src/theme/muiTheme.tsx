import { extendTheme } from "@mui/material/styles";

import Aeonik from "@site/static/fonts/Aeonik-Regular.otf";

// General MUI theme
const extTheme = extendTheme({
  typography: {
    fontFamily: "Aeonik, Arial",
  },
  colorSchemes: {
    light: {
      palette: {
        text: {
          secondary: "#6676aa",
        },
        primary: {
          main: "#001a72", //--swm-navy-light-100
        },
        secondary: {
          main: "#57b495", //--swm-green-light-100
        },
        background: {
          default: "#fcfcff",
          paper: "#f8f9ff",
        },
      },
    },
    dark: {
      palette: {
        text: {
          secondary: "#919fcf",
        },
        primary: {
          main: "#eef0ff", //--swm-navy-light-10
        },
        secondary: {
          main: "#82cab2", //--swm-green-light-80
        },
        background: {
          default: "#232736",
          paper: "#272b3c",
        },
      },
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        @font-face {
          font-family: 'Aeonik';
          font-style: normal;
          font-display: swap;
          font-weight: 400;
          src: local('Aeonik'), local('Aeonik-Regular'), url(${Aeonik}) format('otf');
      `,
    },
  },
});
export default extTheme;
