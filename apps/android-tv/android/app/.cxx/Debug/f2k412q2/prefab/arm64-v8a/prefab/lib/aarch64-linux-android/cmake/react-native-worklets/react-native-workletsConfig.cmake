if(NOT TARGET react-native-worklets::worklets)
add_library(react-native-worklets::worklets INTERFACE IMPORTED)
set_target_properties(react-native-worklets::worklets PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "/Users/hwang-geonju/workspace/infoon/apps/android-tv/node_modules/react-native-worklets/android/build/prefab-headers/worklets"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

