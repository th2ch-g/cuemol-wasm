find_package(TBB CONFIG REQUIRED)
set(_addon "${CMAKE_SOURCE_DIR}/tritium/core/cxx_src")
set(_addon_sources
  init_cuemol.cpp services.cpp wrapper.cpp gui_services.cpp
  ElecView.cpp ElecDisplayContext.cpp EcShaderObject.cpp EcBufferRep.cpp
  EcTexRep.cpp EcDataTexture.cpp EcFloatDataTexture.cpp EcRenderTarget.cpp EcTimerImpl.cpp)
list(TRANSFORM _addon_sources PREPEND "${_addon}/")
add_executable(cuemol_wasm ${_addon_sources} "${CUEMOL_WASM_ROOT}/src/native/browser_posix.cpp" "${CUEMOL_WASM_ROOT}/src/native/browser_rendering.cpp")
target_include_directories(cuemol_wasm PRIVATE
  "${CMAKE_SOURCE_DIR}/src" "${CMAKE_BINARY_DIR}/src"
  "${CUEMOL_WASM_ROOT}/node_modules/node-addon-api"
  "${CUEMOL_WASM_ROOT}/cmake/compat"
  "${Boost_INCLUDE_DIRS}")
target_compile_definitions(cuemol_wasm PRIVATE HAVE_CONFIG_H=1 DEFAULT_CONFIG="/cuemol/sysconfig.xml")
target_compile_features(cuemol_wasm PRIVATE cxx_std_17)
target_link_libraries(cuemol_wasm PRIVATE cuemol2 emnapi-mt TBB::tbb Boost::headers spdlog::spdlog)
target_link_options(cuemol_wasm PRIVATE
  -pthread -fexceptions -msimd128 -lidbfs.js --emit-symbol-map
  "-sDISABLE_EXCEPTION_CATCHING=0"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=134217728"
  "-sMAXIMUM_MEMORY=2147483648"
  "-sSTACK_SIZE=8388608"
  "-sPTHREAD_POOL_SIZE=4"
  "-sDEFAULT_PTHREAD_STACK_SIZE=2097152"
  "-sPTHREAD_POOL_SIZE_STRICT=0"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createCueMolWasm"
  "-sENVIRONMENT=web,worker,node"
  "-sFORCE_FILESYSTEM=1"
  "-sEXPORTED_FUNCTIONS=['_cuemol_browser_init_rendering','_malloc','_free','_napi_register_wasm_v1','_node_api_module_get_api_version_v1']"
  "-sEXPORTED_RUNTIME_METHODS=['emnapiInit','emnapiSyncMemory','FS','IDBFS','HEAPU8','PThread']"
  "-sALLOW_TABLE_GROWTH=1"
  "-sWASM_BIGINT=1"
  "-sASSERTIONS=1"
  "-sWASM_ASYNC_COMPILATION=1")
set_target_properties(cuemol_wasm PROPERTIES OUTPUT_NAME cuemol SUFFIX ".mjs" RUNTIME_OUTPUT_DIRECTORY "${CUEMOL_WASM_ROOT}/build/wasm")
